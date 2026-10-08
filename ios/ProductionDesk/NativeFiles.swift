import Foundation
import PDFKit

enum NativeFileError: LocalizedError {
    case invalidRequest, tooLarge, unreadablePDF, scannedPDF, emptyReport
    var errorDescription: String? {
        switch self {
        case .invalidRequest: return "The local file request was not valid."
        case .tooLarge: return "Choose a file smaller than 40 MB."
        case .unreadablePDF: return "This PDF could not be opened. Unlock it or export an unencrypted copy."
        case .scannedPDF: return "This PDF has no selectable text. Scanned scripts need a text layer before import."
        case .emptyReport: return "Open a report or shot list before sharing a PDF."
        }
    }
}

enum NativeFiles {
    static let maximumBytes = 40 * 1024 * 1024

    static func extractPDF(_ data: Data) throws -> String {
        guard data.count <= maximumBytes else { throw NativeFileError.tooLarge }
        guard let document = PDFDocument(data: data), !document.isLocked else { throw NativeFileError.unreadablePDF }
        // The script parser uses form feeds to retain screenplay page numbers.
        let text = (0..<document.pageCount).map { document.page(at: $0)?.string ?? "" }.joined(separator: "\n\u{000C}\n")
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw NativeFileError.scannedPDF }
        return text
    }

    static func safeFilename(_ raw: String) -> String {
        let name = raw.replacingOccurrences(of: "\\", with: "/").split(separator: "/").last.map(String.init) ?? "Production-Desk-export.json"
        let cleaned = name.components(separatedBy: CharacterSet.controlCharacters.union(CharacterSet(charactersIn: ":"))).joined(separator: "-")
        return cleaned == "." || cleaned == ".." || cleaned.isEmpty ? "Production-Desk-export.json" : String(cleaned.prefix(180))
    }

    static func export(_ data: Data, filename: String, directory: URL = FileManager.default.temporaryDirectory) throws -> URL {
        guard data.count <= maximumBytes else { throw NativeFileError.tooLarge }
        let folder = directory.appendingPathComponent("ProductionDeskShares").appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent(safeFilename(filename))
        try data.write(to: url, options: .atomic)
        return url
    }
}
