/**
 * 乐书书籍下载器 - 连接已有 Chrome 实例，批量打印每页为 PDF 并合并
 * 用法: node download.js <bookId> <totalPages> [outputName]
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BOOK_ID = process.argv[2] || '69c40669a5e0aa6794cd097c';
const TOTAL_PAGES = parseInt(process.argv[3] || '106');
const OUTPUT_NAME = process.argv[4] || 'book';
const OUTPUT_DIR = path.join('C:/Users/Administrator/Desktop', OUTPUT_NAME + '_pages');
const FINAL_PDF = path.join('C:/Users/Administrator/Desktop', OUTPUT_NAME + '.pdf');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {
  // 创建输出目录
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log(`连接到 Chrome (localhost:9222)...`);
  // 读取 DevToolsActivePort 文件动态获取 WebSocket URL（兼容端口变化）
  const activePortFile = 'C:/Users/Administrator/AppData/Local/Google/Chrome/User Data/DevToolsActivePort';
  const portFileContent = fs.readFileSync(activePortFile, 'utf8').trim().split('\n');
  const wsPort = portFileContent[0].trim();
  const wsPath = portFileContent[1].trim();
  const browserWSEndpoint = `ws://127.0.0.1:${wsPort}${wsPath}`;
  console.log(`连接到: ${browserWSEndpoint}`);

  const browser = await puppeteer.connect({
    browserWSEndpoint,
    defaultViewport: { width: 1280, height: 900 }
  });

  const page = await browser.newPage();

  // 设置较宽松的超时
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(30000);

  const pdfFiles = [];

  for (let i = 1; i <= TOTAL_PAGES; i++) {
    const url = `https://leshu8.com/book-chapter?bookId=${BOOK_ID}&page=${i}`;
    const pdfPath = path.join(OUTPUT_DIR, `page_${String(i).padStart(3, '0')}.pdf`);

    // 已存在则跳过（断点续传）
    if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 500) {
      console.log(`[${i}/${TOTAL_PAGES}] 跳过（已存在）`);
      pdfFiles.push(pdfPath);
      continue;
    }

    try {
      // 检测标签页是否已 detached，若是则重新创建
      if (page.isClosed()) {
        console.log('  [标签页已关闭，重新创建...]');
        page = await browser.newPage();
        page.setDefaultTimeout(30000);
        page.setDefaultNavigationTimeout(30000);
      }

      process.stdout.write(`[${i}/${TOTAL_PAGES}] 正在下载... `);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

      // 等待内容区域出现
      await page.waitForSelector('.reader-article', { timeout: 10000 }).catch(() => {});
      await sleep(1500); // 等待字体和图片加载

      // 隐藏 UI 元素（顶部导航栏、底部翻页按钮）
      await page.evaluate(() => {
        // 隐藏顶部导航栏（含 h-12 的那层 div）
        document.querySelectorAll('div').forEach(el => {
          if (el.className && el.className.includes && el.className.includes('h-12')) {
            el.style.display = 'none';
          }
        });
        // 隐藏底部"下一页"按钮容器
        document.querySelectorAll('a').forEach(el => {
          if (el.href && el.href.includes('page=')) {
            const parent = el.closest('div');
            if (parent) parent.style.display = 'none';
          }
        });
        // 隐藏分隔线和 mt-16 间距块
        document.querySelectorAll('.mt-16, .nuxt-loading-indicator, .nuxt-route-announcer').forEach(el => {
          el.style.display = 'none';
        });
      });

      // 打印为 PDF（A4，无页眉页脚）
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', bottom: '15mm', left: '18mm', right: '18mm' },
        displayHeaderFooter: false,
      });

      fs.writeFileSync(pdfPath, pdfBuffer);
      console.log(`✓ (${pdfBuffer.length} bytes)`);
      pdfFiles.push(pdfPath);

    } catch (err) {
      console.log(`✗ 失败: ${err.message}`);
      // detached frame / connection closed：重建标签页后重试一次
      if (err.message.includes('detached') || err.message.includes('closed') || err.message.includes('Connection')) {
        try {
          page = await browser.newPage();
          page.setDefaultTimeout(30000);
          page.setDefaultNavigationTimeout(30000);
          process.stdout.write(`  [重试 ${i}/${TOTAL_PAGES}]... `);
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForSelector('.reader-article', { timeout: 10000 }).catch(() => {});
          await sleep(1500);
          const pdfBuffer = await page.pdf({
            format: 'A4', printBackground: true,
            margin: { top: '15mm', bottom: '15mm', left: '18mm', right: '18mm' },
            displayHeaderFooter: false,
          });
          fs.writeFileSync(pdfPath, pdfBuffer);
          console.log(`✓ (retry, ${pdfBuffer.length} bytes)`);
          pdfFiles.push(pdfPath);
        } catch (retryErr) {
          console.log(`✗ 重试失败: ${retryErr.message}`);
        }
      }
    }

    // 避免请求过于频繁
    await sleep(300);
  }

  await page.close();
  await browser.disconnect();

  console.log(`\n共下载 ${pdfFiles.length}/${TOTAL_PAGES} 页`);
  console.log(`单页 PDF 保存在: ${OUTPUT_DIR}`);

  // 合并 PDF（使用 pdf-lib）
  if (pdfFiles.length > 0) {
    console.log('\n正在合并 PDF...');
    await mergePDFs(pdfFiles, FINAL_PDF);
    console.log(`\n合并完成: ${FINAL_PDF}`);
  }
})().catch(err => {
  console.error('出错:', err);
  process.exit(1);
});

async function mergePDFs(pdfFiles, outputPath) {
  const { PDFDocument } = require('pdf-lib');

  const mergedPdf = await PDFDocument.create();

  for (let i = 0; i < pdfFiles.length; i++) {
    process.stdout.write(`\r合并进度: ${i + 1}/${pdfFiles.length}`);
    try {
      const pdfBytes = fs.readFileSync(pdfFiles[i]);
      const pdf = await PDFDocument.load(pdfBytes);
      const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      pages.forEach(p => mergedPdf.addPage(p));
    } catch (e) {
      console.log(`\n跳过损坏的文件: ${pdfFiles[i]}`);
    }
  }

  const mergedBytes = await mergedPdf.save();
  fs.writeFileSync(outputPath, mergedBytes);
}
