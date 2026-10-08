import XCTest
@testable import ProductionDesk

final class WorkspaceStoreTests: XCTestCase {
    private var root: URL!
    private var directory: URL!

    override func setUpWithError() throws {
        try super.setUpWithError()
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("WorkspaceStoreTests-\(UUID().uuidString)", isDirectory: true)
        directory = root.appendingPathComponent("Library/Workspace", isDirectory: true)
    }

    override func tearDownWithError() throws {
        if let root, FileManager.default.fileExists(atPath: root.path) {
            try FileManager.default.removeItem(at: root)
        }
        try super.tearDownWithError()
    }

    // MARK: First launch

    func testFirstLaunchReturnsNilWithoutCreatingFiles() throws {
        let store = WorkspaceStore(directory: directory)

        XCTAssertNil(try store.load())
        XCTAssertEqual(try store.loadOutcome(), .firstLaunch)
        XCTAssertNil(store.lastRecovery)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path), "Directory should be created lazily")
    }

    func testSaveCreatesMissingDirectories() throws {
        let store = WorkspaceStore(directory: directory)
        try store.save(workspace(projects: ["a"], active: "a"))

        XCTAssertTrue(FileManager.default.fileExists(atPath: store.currentFileURL.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.backupFileURL.path))
    }

    // MARK: Round trip

    func testSavedWorkspaceSurvivesReopening() throws {
        let payload = workspace(projects: ["alpha", "beta"], active: "beta", title: "Spring shoot")
        try WorkspaceStore(directory: directory).save(payload)

        let reopened = WorkspaceStore(directory: directory)
        XCTAssertEqual(try reopened.load(), payload)
        XCTAssertEqual(try reopened.loadOutcome(), .loaded(payload))
        XCTAssertNil(reopened.lastRecovery)
        XCTAssertEqual(try reopened.preservedFiles(), [])
    }

    func testSaveLeavesNoTemporaryFiles() throws {
        let store = WorkspaceStore(directory: directory)
        try store.save(workspace(projects: ["a"], active: "a"))
        try store.save(workspace(projects: ["a", "b"], active: "b"))

        let names = try FileManager.default.contentsOfDirectory(atPath: directory.path).sorted()
        XCTAssertEqual(names, ["workspace.json", "workspace.previous.json"])
    }

    // MARK: Backup

    func testSecondSaveKeepsPreviousWorkspaceAsBackup() throws {
        let store = WorkspaceStore(directory: directory)
        let first = workspace(projects: ["a"], active: "a", title: "first")
        let second = workspace(projects: ["a", "b"], active: "b", title: "second")
        let third = workspace(projects: ["c"], active: "c", title: "third")

        try store.save(first)
        try store.save(second)
        XCTAssertEqual(try Data(contentsOf: store.currentFileURL), second)
        XCTAssertEqual(try Data(contentsOf: store.backupFileURL), first)

        try store.save(third)
        XCTAssertEqual(try Data(contentsOf: store.currentFileURL), third)
        XCTAssertEqual(try Data(contentsOf: store.backupFileURL), second)
    }

    func testSavingIdenticalBytesDoesNotReplaceBackup() throws {
        let store = WorkspaceStore(directory: directory)
        let first = workspace(projects: ["a"], active: "a", title: "first")
        let second = workspace(projects: ["b"], active: "b", title: "second")

        try store.save(first)
        try store.save(second)
        try store.save(second)

        XCTAssertEqual(try Data(contentsOf: store.backupFileURL), first)
    }

    // MARK: Validation

    func testInvalidPayloadsAreRejectedAndCurrentIsUnchanged() throws {
        let store = WorkspaceStore(directory: directory)
        let good = workspace(projects: ["a"], active: "a")
        try store.save(good)

        let cases: [(Data, WorkspaceValidationError)] = [
            (Data(), .empty),
            (Data("[1, 2]".utf8), .notAnObject),
            (json(["projects": [["id": "a"]], "activeProject": "a"]), .unsupportedVersion(found: "missing")),
            (json(["version": 2, "projects": [["id": "a"]], "activeProject": "a"]), .unsupportedVersion(found: "2")),
            (json(["version": true, "projects": [["id": "a"]], "activeProject": "a"]), .unsupportedVersion(found: "1")),
            (json(["version": 1, "activeProject": "a"]), .missingProjects),
            (json(["version": 1, "projects": [Any](), "activeProject": "a"]), .noProjects),
            (json(["version": 1, "projects": [["name": "x"]], "activeProject": "a"]), .invalidProject(index: 0)),
            (json(["version": 1, "projects": [["id": "a"], ["id": ""]], "activeProject": "a"]), .invalidProject(index: 1)),
            (json(["version": 1, "projects": [["id": "a"], ["id": "a"]], "activeProject": "a"]), .duplicateProjectID("a")),
            (json(["version": 1, "projects": [["id": "a"]]]), .missingActiveProject),
            (json(["version": 1, "projects": [["id": "a"]], "activeProject": "z"]), .activeProjectNotFound("z")),
        ]

        for (payload, expected) in cases {
            XCTAssertThrowsError(try store.save(payload)) { error in
                guard case let .invalidWorkspace(problem) = error as? WorkspaceStoreError else {
                    return XCTFail("Unexpected error \(error)")
                }
                XCTAssertEqual(problem, expected)
            }
        }

        XCTAssertThrowsError(try store.save(Data("{not json".utf8))) { error in
            guard case .invalidWorkspace(.notJSON) = error as? WorkspaceStoreError else {
                return XCTFail("Unexpected error \(error)")
            }
        }

        XCTAssertEqual(try store.load(), good)
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.backupFileURL.path),
                       "Rejected saves must not rotate the backup")
    }

    func testRejectedSaveOnFirstLaunchCreatesNothing() throws {
        let store = WorkspaceStore(directory: directory)
        XCTAssertThrowsError(try store.save(Data("{}".utf8)))
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
        XCTAssertNil(try store.load())
    }

    func testValidationErrorsAreActionable() {
        let error = WorkspaceStoreError.invalidWorkspace(.duplicateProjectID("p1"))
        XCTAssertTrue(error.localizedDescription.contains("p1"))
        XCTAssertNotNil(error.recoverySuggestion)
    }

    // MARK: Corruption recovery

    func testCorruptCurrentRecoversBackupAndPreservesDamagedFile() throws {
        let store = WorkspaceStore(directory: directory)
        let first = workspace(projects: ["a"], active: "a", title: "first")
        let second = workspace(projects: ["b"], active: "b", title: "second")
        try store.save(first)
        try store.save(second)

        let damaged = Data("{\"version\": 1, \"projects\": [".utf8)
        try damaged.write(to: store.currentFileURL)

        let reopened = WorkspaceStore(directory: directory)
        let outcome = try reopened.loadOutcome()

        guard case let .recovered(data, recovery) = outcome else {
            return XCTFail("Expected recovery, got \(outcome)")
        }
        XCTAssertEqual(data, first)
        guard case .currentInvalid(.notJSON) = recovery.cause else {
            return XCTFail("Unexpected cause \(recovery.cause)")
        }
        XCTAssertEqual(reopened.lastRecovery, recovery)

        let preserved = try XCTUnwrap(recovery.preservedFile)
        XCTAssertEqual(try Data(contentsOf: preserved), damaged, "Damaged bytes must be kept verbatim")
        XCTAssertEqual(try reopened.preservedFiles(), [preserved])

        // The restored workspace is now current; the backup is untouched.
        XCTAssertEqual(try Data(contentsOf: reopened.currentFileURL), first)
        XCTAssertEqual(try Data(contentsOf: reopened.backupFileURL), first)
        XCTAssertEqual(try reopened.loadOutcome(), .loaded(first))
        XCTAssertNil(reopened.lastRecovery)
    }

    func testStructurallyInvalidCurrentIsTreatedAsCorrupt() throws {
        let store = WorkspaceStore(directory: directory)
        let first = workspace(projects: ["a"], active: "a")
        try store.save(first)
        try store.save(workspace(projects: ["b"], active: "b"))

        let invalid = json(["version": 1, "projects": [["id": "x"]], "activeProject": "missing"])
        try invalid.write(to: store.currentFileURL)

        XCTAssertEqual(try store.load(), first)
        XCTAssertEqual(store.lastRecovery?.cause, .currentInvalid(.activeProjectNotFound("missing")))
    }

    func testMissingCurrentWithBackupRecoversInsteadOfFirstLaunch() throws {
        let store = WorkspaceStore(directory: directory)
        let first = workspace(projects: ["a"], active: "a")
        try store.save(first)
        try store.save(workspace(projects: ["b"], active: "b"))
        try FileManager.default.removeItem(at: store.currentFileURL)

        let outcome = try store.loadOutcome()
        XCTAssertEqual(outcome, .recovered(first, WorkspaceRecovery(cause: .currentMissing, preservedFile: nil)))
        XCTAssertEqual(try Data(contentsOf: store.currentFileURL), first)
    }

    func testSavingOverDamagedCurrentPreservesItAndKeepsBackup() throws {
        let store = WorkspaceStore(directory: directory)
        let first = workspace(projects: ["a"], active: "a", title: "first")
        try store.save(first)
        try store.save(workspace(projects: ["b"], active: "b"))

        let damaged = Data("garbage".utf8)
        try damaged.write(to: store.currentFileURL)

        let next = workspace(projects: ["c"], active: "c")
        try store.save(next)

        XCTAssertEqual(try store.load(), next)
        XCTAssertEqual(try Data(contentsOf: store.backupFileURL), first,
                       "A damaged current file must never become the backup")
        let preserved = try store.preservedFiles()
        XCTAssertEqual(preserved.count, 1)
        XCTAssertEqual(try Data(contentsOf: preserved[0]), damaged)
    }

    // MARK: Unrecoverable

    func testCorruptCurrentWithoutBackupThrowsAndLeavesFileInPlace() throws {
        let store = WorkspaceStore(directory: directory)
        try store.save(workspace(projects: ["a"], active: "a"))
        let damaged = Data("{\"version\": 1".utf8)
        try damaged.write(to: store.currentFileURL)

        XCTAssertThrowsError(try store.load()) { error in
            guard case let .unrecoverableWorkspace(current, backup, preserved) = error as? WorkspaceStoreError else {
                return XCTFail("Unexpected error \(error)")
            }
            guard case .notJSON = current else { return XCTFail("Unexpected current problem \(String(describing: current))") }
            XCTAssertNil(backup)
            XCTAssertEqual(preserved, store.currentFileURL)
            XCTAssertNotNil((error as? WorkspaceStoreError)?.recoverySuggestion)
        }

        XCTAssertEqual(try Data(contentsOf: store.currentFileURL), damaged, "Load must not modify the damaged file")
        XCTAssertEqual(try store.preservedFiles(), [])

        // An explicit, reviewed save afterwards still keeps the damaged bytes.
        let fresh = workspace(projects: ["new"], active: "new")
        try store.save(fresh)
        XCTAssertEqual(try store.load(), fresh)
        let preserved = try store.preservedFiles()
        XCTAssertEqual(preserved.count, 1)
        XCTAssertEqual(try Data(contentsOf: preserved[0]), damaged)
    }

    func testCorruptCurrentAndCorruptBackupThrows() throws {
        let store = WorkspaceStore(directory: directory)
        try store.save(workspace(projects: ["a"], active: "a"))
        try store.save(workspace(projects: ["b"], active: "b"))
        try Data("bad current".utf8).write(to: store.currentFileURL)
        try json(["version": 1, "projects": [Any]()]).write(to: store.backupFileURL)

        XCTAssertThrowsError(try store.load()) { error in
            guard case let .unrecoverableWorkspace(current, backup, _) = error as? WorkspaceStoreError else {
                return XCTFail("Unexpected error \(error)")
            }
            XCTAssertNotNil(current)
            XCTAssertEqual(backup, .noProjects)
        }
        XCTAssertEqual(try Data(contentsOf: store.currentFileURL), Data("bad current".utf8))
    }

    func testMissingCurrentAndCorruptBackupThrowsInsteadOfFirstLaunch() throws {
        let store = WorkspaceStore(directory: directory)
        try store.save(workspace(projects: ["a"], active: "a"))
        try store.save(workspace(projects: ["b"], active: "b"))
        try FileManager.default.removeItem(at: store.currentFileURL)
        try Data("bad backup".utf8).write(to: store.backupFileURL)

        XCTAssertThrowsError(try store.load()) { error in
            guard case let .unrecoverableWorkspace(current, backup, preserved) = error as? WorkspaceStoreError else {
                return XCTFail("Unexpected error \(error)")
            }
            XCTAssertNil(current)
            XCTAssertNotNil(backup)
            XCTAssertNil(preserved)
        }
    }

    // MARK: Size limit

    func testDefaultLimitIsFortyMebibytes() {
        XCTAssertEqual(WorkspaceStore.maximumByteCount, 41_943_040)
        XCTAssertEqual(WorkspaceStore(directory: directory).maximumByteCount, 41_943_040)
    }

    func testOversizedSaveIsRejected() throws {
        let store = WorkspaceStore(directory: directory, maximumByteCount: 512)
        let good = workspace(projects: ["a"], active: "a")
        try store.save(good)

        let oversized = workspace(projects: ["a"], active: "a", title: String(repeating: "x", count: 1_000))
        XCTAssertThrowsError(try store.save(oversized)) { error in
            guard case let .invalidWorkspace(.tooLarge(byteCount, limit)) = error as? WorkspaceStoreError else {
                return XCTFail("Unexpected error \(error)")
            }
            XCTAssertEqual(byteCount, oversized.count)
            XCTAssertEqual(limit, 512)
        }
        XCTAssertEqual(try store.load(), good)
    }

    func testOversizedFileOnDiskIsRecoveredFromBackup() throws {
        let store = WorkspaceStore(directory: directory, maximumByteCount: 512)
        let first = workspace(projects: ["a"], active: "a")
        try store.save(first)
        try store.save(workspace(projects: ["b"], active: "b"))

        let huge = workspace(projects: ["a"], active: "a", title: String(repeating: "y", count: 2_000))
        try huge.write(to: store.currentFileURL)

        XCTAssertEqual(try store.load(), first)
        XCTAssertEqual(store.lastRecovery?.cause, .currentInvalid(.tooLarge(byteCount: huge.count, limit: 512)))
        let preserved = try XCTUnwrap(store.lastRecovery?.preservedFile)
        XCTAssertEqual(try Data(contentsOf: preserved), huge)
    }

    // MARK: Serialization

    func testConcurrentSavesFromSeparateInstancesStayConsistent() throws {
        let payloads = (0..<24).map { workspace(projects: ["p\($0)"], active: "p\($0)") }
        try WorkspaceStore(directory: directory).save(payloads[0])

        let failures = Failures()
        DispatchQueue.concurrentPerform(iterations: payloads.count) { index in
            do {
                try WorkspaceStore(directory: directory).save(payloads[index])
            } catch {
                failures.append(error)
            }
        }
        XCTAssertTrue(failures.isEmpty, "Saves failed: \(failures.all)")

        let store = WorkspaceStore(directory: directory)
        let current = try XCTUnwrap(try store.load())
        let backup = try Data(contentsOf: store.backupFileURL)
        XCTAssertTrue(payloads.contains(current))
        XCTAssertTrue(payloads.contains(backup))
        XCTAssertNil(store.lastRecovery)
        XCTAssertEqual(try store.preservedFiles(), [])

        let leftovers = try FileManager.default.contentsOfDirectory(atPath: directory.path)
            .filter { $0.hasSuffix(".tmp") }
        XCTAssertEqual(leftovers, [])
    }

    // MARK: Helpers

    private func workspace(projects: [String], active: String, title: String? = nil) -> Data {
        var object: [String: Any] = [
            "version": 1,
            "projects": projects.map { ["id": $0, "name": "Project \($0)"] },
            "activeProject": active,
        ]
        if let title { object["title"] = title }
        return json(object)
    }

    private func json(_ object: [String: Any]) -> Data {
        // Sorted keys keep the bytes deterministic for equality checks.
        try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }
}

private final class Failures: @unchecked Sendable {
    private let lock = NSLock()
    private var errors: [Error] = []

    func append(_ error: Error) {
        lock.lock()
        errors.append(error)
        lock.unlock()
    }

    var all: [Error] {
        lock.lock()
        defer { lock.unlock() }
        return errors
    }

    var isEmpty: Bool { all.isEmpty }
}
