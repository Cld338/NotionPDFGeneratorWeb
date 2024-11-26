import 'dart:io';
import 'dart:typed_data';
import 'package:shelf/shelf.dart' as shelf;
import 'package:shelf/shelf_io.dart' as io;
import 'package:shelf_static/shelf_static.dart';
import 'package:path/path.dart' as path;
import 'package:archive/archive.dart';
import 'package:puppeteer/puppeteer.dart';

class NotionPdfServer {
  // PDF 변환 옵션 클래스
  class PdfOptions {
    final String width;
    final bool includeBanner;
    final bool includeTitle;
    final bool includeTags;

    PdfOptions({
      this.width = '1440px',
      this.includeBanner = true,
      this.includeTitle = true,
      this.includeTags = true,
    });
  }

  Future<void> startServer() async {
    final port = 80;
    final ip = InternetAddress.anyIPv4;

    // 정적 파일 핸들러
    final staticHandler = createStaticHandler('public');

    // 라우터 설정
    final handler = const shelf.Pipeline()
        .addMiddleware(shelf.logRequests())
        .addHandler((request) async {
      if (request.url.path == 'upload' && request.method == 'POST') {
        return handleUpload(request);
      }
      return staticHandler(request);
    });

    final server = await io.serve(handler, ip, port);
    print('서버가 실행 중입니다: http://${server.address.host}:${server.port}');
  }

  Future<shelf.Response> handleUpload(shelf.Request request) async {
    try {
      // 파일 업로드 처리
      final uploadedData = await request.read().toList();
      final options = PdfOptions(); // 요청에서 옵션 파싱 필요

      // 임시 디렉토리 생성
      final extractDir = Directory('public/extracted');
      final outputDir = Directory('public/out');
      await extractDir.create(recursive: true);
      await outputDir.create(recursive: true);

      // ZIP 파일 압축 해제
      final archive = ZipDecoder().decodeBytes(uploadedData.first);
      for (final file in archive) {
        if (file.isFile) {
          final outputFile = File(path.join(extractDir.path, file.name));
          await outputFile.create(recursive: true);
          await outputFile.writeAsBytes(file.content as List<int>);
        }
      }

      // HTML 파일을 PDF로 변환
      final pdfFiles = <String>[];
      final htmlFiles = extractDir
          .listSync()
          .where((f) => path.extension(f.path) == '.html')
          .toList();

      for (var i = 0; i < htmlFiles.length; i++) {
        final file = htmlFiles[i];
        final pdfBuffer = await convertToPdf(file.path, options, i + 1, htmlFiles.length);
        final pdfPath = path.join(outputDir.path, '${path.basenameWithoutExtension(file.path)}.pdf');
        await File(pdfPath).writeAsBytes(pdfBuffer);
        pdfFiles.add(pdfPath);
      }

      // PDF 파일들을 ZIP으로 압축
      final zipBytes = await createZipArchive(pdfFiles);

      // 정리
      await extractDir.delete(recursive: true);
      await outputDir.delete(recursive: true);

      return shelf.Response.ok(
        zipBytes,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="pdfs.zip"',
        },
      );
    } catch (e) {
      print('오류 발생: $e');
      return shelf.Response.internalServerError(body: '파일 처리 중 오류가 발생했습니다.');
    }
  }

  Future<Uint8List> convertToPdf(
    String filePath,
    PdfOptions options,
    int fileIndex,
    int totalFiles,
  ) async {
    print('PDF 변환 중: ${path.basename(filePath)} ($fileIndex/$totalFiles)');
    
    final browser = await puppeteer.launch(
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    );
    
    final page = await browser.newPage();
    await page.goto('file://$filePath', wait: Until.networkIdle);
    
    // PDF 설정 및 변환 로직
    final pdfBytes = await page.pdf(format: PdfFormat(
      width: options.width,
      printBackground: true,
      margin: EdgeInsets.zero,
    ));

    await browser.close();
    return pdfBytes;
  }

  Future<Uint8List> createZipArchive(List<String> files) async {
    final archive = Archive();
    for (final filePath in files) {
      final fileBytes = await File(filePath).readAsBytes();
      archive.addFile(ArchiveFile(
        path.basename(filePath),
        fileBytes.length,
        fileBytes,
      ));
    }
    return ZipEncoder().encode(archive)!;
  }
}

void main() async {
  final server = NotionPdfServer();
  await server.startServer();
} 