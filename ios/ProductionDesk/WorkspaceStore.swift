import Foundation

// MARK: - Schema

/// Describes the top-level workspace JSON shape that `WorkspaceStore` checks
/// independently of the JavaScript layer.
///
/// The store deliberately validates only the envelope (version, project list,
/// active project). Detailed relationship checks stay in JavaScript.
public struct WorkspaceSchema: Equatable, Sendable {
    public var supportedVersion: Int
    public var versionKey: String
    public var projectsKey: String
    public var activeProjectKey: String
    public var projectIDKey: String

    public init(
        supportedVersion: Int = 1,
        versionKey: String = "version",
        projectsKey: String = "projects",
        activeProjectKey: String = "activeProject",
        projectIDKey: String = "id"
    ) {
        self.supportedVersion = supportedVersion
        self.versionKey = versionKey
        self.projectsKey = projectsKey
        self.activeProjectKey = activeProjectKey
        self.projectIDKey = projectIDKey
    }

    public static let standard = WorkspaceSchema()
}

// MARK: - Errors

/// Why a workspace payload was rejected.
public enum WorkspaceValidationError: Error, Equatable, Sendable {
    case empty
    case tooLarge(byteCount: Int, limit: Int)
    case notJSON(detail: String)
    case notAnObject
    case unsupportedVersion(found: String)
    case missingProjects
    case noProjects
    case invalidProject(index: Int)
    case duplicateProjectID(String)
    case missingActiveProject
    case activeProjectNotFound(String)

    public var reason: String {
        switch self {
        case .empty:
            return "The workspace is empty."
        case let .tooLarge(byteCount, limit):
            return "The workspace is \(byteCount) bytes, which exceeds the \(limit)-byte limit."
        case let .notJSON(detail):
            return "The workspace is not valid JSON (\(detail))."
        case .notAnObject:
            return "The workspace must be a JSON object."
        case let .unsupportedVersion(found):
            return "The workspace version \(found) is not supported."
        case .missingProjects:
            return "The workspace has no project list."
        case .noProjects:
            return "The workspace must contain at least one project."
        case let .invalidProject(index):
            return "Project \(index + 1) is missing a non-empty ID."
        case let .duplicateProjectID(id):
            return "More than one project uses the ID \"\(id)\"."
        case .missingActiveProject:
            return "The workspace does not name an active project."
        case let .activeProjectNotFound(id):
            return "The active project \"\(id)\" is not in the project list."
        }
    }
}

public enum WorkspaceStoreError: Error, LocalizedError {
    /// `save(_:)` refused the payload. Nothing on disk was changed.
    case invalidWorkspace(WorkspaceValidationError)

    /// The saved workspace is damaged and no valid backup exists.
    /// Nothing was deleted or overwritten; the damaged file is still at
    /// `preservedFile` (nil when the current file is missing entirely).
    case unrecoverableWorkspace(
        currentProblem: WorkspaceValidationError?,
        backupProblem: WorkspaceValidationError?,
        preservedFile: URL?
    )

    /// A file-system operation failed. On-disk state is unchanged or still
    /// recoverable on the next `load()`.
    case fileSystem(operation: String, url: URL, underlying: Error)

    public var errorDescription: String? {
        switch self {
        case let .invalidWorkspace(problem):
            return "The workspace was not saved. \(problem.reason)"
        case let .unrecoverableWorkspace(currentProblem, backupProblem, preservedFile):
            var parts = ["The saved workspace could not be opened and no usable backup was found."]
            if let currentProblem {
                parts.append("Current file: \(currentProblem.reason)")
            } else {
                parts.append("Current file: missing.")
            }
            if let backupProblem {
                parts.append("Backup: \(backupProblem.reason)")
            } else {
                parts.append("Backup: missing.")
            }
            if let preservedFile {
                parts.append("The damaged file was left untouched at \(preservedFile.path).")
            }
            return parts.joined(separator: " ")
        case let .fileSystem(operation, url, underlying):
            return "Could not \(operation) at \(url.path): \(underlying.localizedDescription)"
        }
    }

    public var recoverySuggestion: String? {
        switch self {
        case .invalidWorkspace:
            return "Your last saved workspace is unchanged. Fix the workspace and save again."
        case .unrecoverableWorkspace:
            return "Export the damaged file for review, or start a new workspace. Starting a new workspace keeps a copy of the damaged file."
        case .fileSystem:
            return "Make sure the device is unlocked and has free storage, then try again."
        }
    }
}

// MARK: - Load results

/// Details of an automatic recovery performed by `load()`.
public struct WorkspaceRecovery: Equatable, Sendable {
    public enum Cause: Equatable, Sendable {
        /// The current file failed validation.
        case currentInvalid(WorkspaceValidationError)
        /// The current file was missing but a backup existed.
        case currentMissing
    }

    public let cause: Cause
    /// Where the damaged current file was moved. Nil when it was missing.
    public let preservedFile: URL?
}

public enum WorkspaceLoadOutcome: Equatable {
    /// No workspace has ever been saved in this directory.
    case firstLaunch
    case loaded(Data)
    /// The current file was damaged or missing; the backup was restored.
    case recovered(Data, WorkspaceRecovery)

    public var data: Data? {
        switch self {
        case .firstLaunch: return nil
        case let .loaded(data), let .recovered(data, _): return data
        }
    }
}

// MARK: - Store

/// Durable, validated storage for the Production Desk workspace JSON.
///
/// Layout inside `directory` (created on first save):
/// - `workspace.json`: current workspace
/// - `workspace.previous.json`: the previous valid workspace
/// - `Recovered/`: damaged files moved aside, never deleted by the store
///
/// All access is serialized per directory, across every `WorkspaceStore`
/// instance in the process. Writes go to a temporary file, are flushed to
/// stable storage, then renamed over the destination.
public final class WorkspaceStore: @unchecked Sendable {
    public static let maximumByteCount = 40 * 1024 * 1024

    public let directory: URL
    public let schema: WorkspaceSchema
    public let maximumByteCount: Int

    public var currentFileURL: URL { directory.appendingPathComponent("workspace.json") }
    public var backupFileURL: URL { directory.appendingPathComponent("workspace.previous.json") }
    public var recoveredDirectoryURL: URL { directory.appendingPathComponent("Recovered", isDirectory: true) }

    /// Set by the most recent `load()`; nil unless that load restored the backup.
    public var lastRecovery: WorkspaceRecovery? {
        lock.lock()
        defer { lock.unlock() }
        return _lastRecovery
    }

    private var _lastRecovery: WorkspaceRecovery?
    private let lock: NSRecursiveLock
    private let fileManager = FileManager.default

    public init(
        directory: URL,
        schema: WorkspaceSchema = .standard,
        maximumByteCount: Int = WorkspaceStore.maximumByteCount
    ) {
        self.directory = directory.standardizedFileURL
        self.schema = schema
        self.maximumByteCount = maximumByteCount
        self.lock = DirectoryLocks.shared.lock(for: self.directory.path)
    }

    // MARK: Public API

    /// Returns the saved workspace, or nil on first launch.
    ///
    /// If the current file is damaged and the backup is valid, the damaged
    /// file is moved into `Recovered/`, the backup is restored, and
    /// `lastRecovery` describes what happened.
    public func load() throws -> Data? {
        try loadOutcome().data
    }

    public func loadOutcome() throws -> WorkspaceLoadOutcome {
        lock.lock()
        defer { lock.unlock() }

        _lastRecovery = nil
        let current = try readCandidate(at: currentFileURL)

        if case let .valid(data) = current {
            return .loaded(data)
        }

        let backup = try readCandidate(at: backupFileURL)

        switch (current, backup) {
        case (.missing, .missing):
            return .firstLaunch

        case let (.missing, .valid(data)):
            try writeDurably(data, to: currentFileURL)
            let recovery = WorkspaceRecovery(cause: .currentMissing, preservedFile: nil)
            _lastRecovery = recovery
            return .recovered(data, recovery)

        case let (.invalid(problem), .valid(data)):
            let preserved = try quarantineCurrentFile()
            try writeDurably(data, to: currentFileURL)
            let recovery = WorkspaceRecovery(cause: .currentInvalid(problem), preservedFile: preserved)
            _lastRecovery = recovery
            return .recovered(data, recovery)

        default:
            throw WorkspaceStoreError.unrecoverableWorkspace(
                currentProblem: current.problem,
                backupProblem: backup.problem,
                preservedFile: current.isMissing ? nil : currentFileURL
            )
        }
    }

    /// Validates and durably saves `data` as the current workspace.
    ///
    /// The previous current file becomes the backup if it is valid. A damaged
    /// current file is moved into `Recovered/` rather than overwritten. If the
    /// payload is invalid, nothing on disk changes.
    public func save(_ data: Data) throws {
        if let problem = validate(data) {
            throw WorkspaceStoreError.invalidWorkspace(problem)
        }

        lock.lock()
        defer { lock.unlock() }

        try ensureDirectory(directory)

        switch try readCandidate(at: currentFileURL) {
        case .missing:
            break
        case let .valid(existing):
            if existing == data { return }
            try writeDurably(existing, to: backupFileURL)
        case .invalid:
            _ = try quarantineCurrentFile()
        }

        try writeDurably(data, to: currentFileURL)
    }

    /// Files moved aside by recovery or by saving over a damaged workspace.
    public func preservedFiles() throws -> [URL] {
        lock.lock()
        defer { lock.unlock() }
        guard fileManager.fileExists(atPath: recoveredDirectoryURL.path) else { return [] }
        do {
            // Build URLs from our own directory URL so they match the
            // `preservedFile` values reported by recovery and errors.
            return try fileManager
                .contentsOfDirectory(atPath: recoveredDirectoryURL.path)
                .filter { !$0.hasPrefix(".") }
                .sorted()
                .map { recoveredDirectoryURL.appendingPathComponent($0) }
        } catch {
            throw WorkspaceStoreError.fileSystem(operation: "list recovered files", url: recoveredDirectoryURL, underlying: error)
        }
    }

    /// Checks the top-level workspace shape. Returns nil when valid.
    public func validate(_ data: Data) -> WorkspaceValidationError? {
        WorkspaceValidator(schema: schema, maximumByteCount: maximumByteCount).validate(data)
    }

    // MARK: Reading

    private enum Candidate {
        case missing
        case valid(Data)
        case invalid(WorkspaceValidationError)

        var problem: WorkspaceValidationError? {
            if case let .invalid(problem) = self { return problem }
            return nil
        }

        var isMissing: Bool {
            if case .missing = self { return true }
            return false
        }
    }

    /// Reads and validates a file. I/O failures throw instead of being
    /// treated as corruption, so a locked device never triggers recovery.
    private func readCandidate(at url: URL) throws -> Candidate {
        let attributes: [FileAttributeKey: Any]
        do {
            attributes = try fileManager.attributesOfItem(atPath: url.path)
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            return .missing
        } catch {

            throw WorkspaceStoreError.fileSystem(operation: "inspect the workspace", url: url, underlying: error)
        }

        if let size = (attributes[.size] as? NSNumber)?.intValue, size > maximumByteCount {
            return .invalid(.tooLarge(byteCount: size, limit: maximumByteCount))
        }

        let data: Data
        do {
            data = try Data(contentsOf: url, options: .uncached)
        } catch {
            throw WorkspaceStoreError.fileSystem(operation: "read the workspace", url: url, underlying: error)
        }

        if let problem = validate(data) {
            return .invalid(problem)
        }
        return .valid(data)
    }

    // MARK: Writing

    private func ensureDirectory(_ url: URL) throws {
        var isDirectory: ObjCBool = false
        if fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue {
            return
        }
        do {
            try fileManager.createDirectory(at: url, withIntermediateDirectories: true, attributes: Self.protectionAttributes)
        } catch {
            throw WorkspaceStoreError.fileSystem(operation: "create the storage folder", url: url, underlying: error)
        }
    }

    /// Moves the current file into `Recovered/` with a unique name.
    private func quarantineCurrentFile() throws -> URL {
        try ensureDirectory(recoveredDirectoryURL)
        let destination = recoveredDirectoryURL.appendingPathComponent(Self.quarantineName())
        guard rename(currentFileURL.path, destination.path) == 0 else {
            throw posixFailure("move the damaged workspace aside", currentFileURL)
        }
        syncDirectory(recoveredDirectoryURL)
        syncDirectory(directory)
        return destination
    }

    /// Writes to a temporary sibling, flushes it, then renames it into place.
    private func writeDurably(_ data: Data, to destination: URL) throws {
        try ensureDirectory(destination.deletingLastPathComponent())

        let tempURL = destination.deletingLastPathComponent()
            .appendingPathComponent(".\(destination.lastPathComponent).\(UUID().uuidString).tmp")
        let fd = open(tempURL.path, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0o600)
        guard fd >= 0 else {
            throw posixFailure("create a temporary file", tempURL)
        }

        var renamed = false
        defer {
            if !renamed { unlink(tempURL.path) }
        }

        do {
            applyProtection(to: tempURL)
            try writeAll(data, to: fd, url: tempURL)
            try flushToStableStorage(fd, url: tempURL)
        } catch {
            close(fd)
            throw error
        }

        guard close(fd) == 0 else {
            throw posixFailure("finish writing", tempURL)
        }
        guard rename(tempURL.path, destination.path) == 0 else {
            throw posixFailure("replace the workspace", destination)
        }
        renamed = true
        syncDirectory(destination.deletingLastPathComponent())
    }

    private func writeAll(_ data: Data, to fd: Int32, url: URL) throws {
        try data.withUnsafeBytes { (buffer: UnsafeRawBufferPointer) in
            guard let base = buffer.baseAddress else { return }
            var offset = 0
            while offset < buffer.count {
                let written = write(fd, base + offset, buffer.count - offset)
                if written < 0 {
                    if errno == EINTR { continue }
                    throw posixFailure("write the workspace", url)
                }
                offset += written
            }
        }
    }

    private func flushToStableStorage(_ fd: Int32, url: URL) throws {
        // F_FULLFSYNC asks the drive to flush its cache; fall back to fsync
        // on file systems that do not support it.
        if fcntl(fd, F_FULLFSYNC) == 0 { return }
        guard fsync(fd) == 0 else {
            throw posixFailure("flush the workspace to storage", url)
        }
    }

    /// Best effort: persists the rename in the directory entry.
    private func syncDirectory(_ url: URL) {
        let fd = open(url.path, O_RDONLY | O_CLOEXEC)
        guard fd >= 0 else { return }
        if fcntl(fd, F_FULLFSYNC) != 0 { _ = fsync(fd) }
        close(fd)
    }

    private func applyProtection(to url: URL) {
        #if os(iOS)
        try? fileManager.setAttributes(Self.protectionAttributes ?? [:], ofItemAtPath: url.path)
        #endif
    }

    private func posixFailure(_ operation: String, _ url: URL) -> WorkspaceStoreError {
        let code = POSIXErrorCode(rawValue: errno) ?? .EIO
        return .fileSystem(operation: operation, url: url, underlying: POSIXError(code))
    }

    // MARK: Helpers

    private static var protectionAttributes: [FileAttributeKey: Any]? {
        #if os(iOS)
        // The bridge may save while the app finishes work in the background
        // after the device locks, so Complete protection would break saves.
        return [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        #else
        return nil
        #endif
    }

    private static func quarantineName() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
        let stamp = formatter.string(from: Date())
        let suffix = UUID().uuidString.prefix(8)
        return "workspace-damaged-\(stamp)-\(suffix).json"
    }
}

// MARK: - Validation

struct WorkspaceValidator {
    let schema: WorkspaceSchema
    let maximumByteCount: Int

    func validate(_ data: Data) -> WorkspaceValidationError? {
        if data.isEmpty { return .empty }
        if data.count > maximumByteCount {
            return .tooLarge(byteCount: data.count, limit: maximumByteCount)
        }

        let object: Any
        do {
            object = try JSONSerialization.jsonObject(with: data, options: [])
        } catch {
            return .notJSON(detail: (error as NSError).localizedDescription)
        }

        guard let root = object as? [String: Any] else { return .notAnObject }

        guard let version = root[schema.versionKey] else {
            return .unsupportedVersion(found: "missing")
        }
        guard let number = version as? NSNumber,
              !Self.isBoolean(number),
              number.doubleValue == Double(schema.supportedVersion) else {
            return .unsupportedVersion(found: String(describing: version))
        }

        guard let projects = root[schema.projectsKey] as? [Any] else { return .missingProjects }
        if projects.isEmpty { return .noProjects }

        var seen = Set<String>()
        for (index, entry) in projects.enumerated() {
            guard let project = entry as? [String: Any],
                  let id = project[schema.projectIDKey] as? String,
                  !id.isEmpty else {
                return .invalidProject(index: index)
            }
            if !seen.insert(id).inserted { return .duplicateProjectID(id) }
        }

        guard let active = root[schema.activeProjectKey] as? String, !active.isEmpty else {
            return .missingActiveProject
        }
        if !seen.contains(active) { return .activeProjectNotFound(active) }

        return nil
    }

    private static func isBoolean(_ number: NSNumber) -> Bool {
        CFGetTypeID(number) == CFBooleanGetTypeID()
    }
}

// MARK: - Locks

/// One lock per storage directory, shared by every store instance.
private final class DirectoryLocks: @unchecked Sendable {
    static let shared = DirectoryLocks()

    private let guardLock = NSLock()
    private var locks: [String: NSRecursiveLock] = [:]

    func lock(for path: String) -> NSRecursiveLock {
        guardLock.lock()
        defer { guardLock.unlock() }
        if let existing = locks[path] { return existing }
        let lock = NSRecursiveLock()
        locks[path] = lock
        return lock
    }
}
