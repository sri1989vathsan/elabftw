// Prints, for every page of a PDF, its size in points and its text (macOS PDFKit):  swiftc pdf-text.swift -o pdf-text && ./pdf-text file.pdf
import PDFKit
guard CommandLine.arguments.count > 1, let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else { exit(1) }
for i in 0..<doc.pageCount {
  let p = doc.page(at: i)!; let r = p.bounds(for: .mediaBox)
  print("=== page \(i + 1) \(Int(r.width))x\(Int(r.height))")
  print(p.string ?? "")
}
