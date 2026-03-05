const fs = require('fs');
const path = require('path');
const https = require('https');

const MODEL_URL =
  'https://github.com/tesseract-ocr/tessdata_best/raw/main/eng.traineddata';
const OUTPUT_DIR = path.resolve(__dirname, '..', 'assets', 'ocr');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'eng.traineddata');

function download(url, destination, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects while downloading OCR data'));
      return;
    }

    const request = https.get(url, (response) => {
      const status = response.statusCode || 0;

      if (status >= 300 && status < 400 && response.headers.location) {
        const redirectUrl = new URL(response.headers.location, url).toString();
        response.resume();
        resolve(download(redirectUrl, destination, redirectCount + 1));
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Download failed (${status})`));
        return;
      }

      const tempPath = `${destination}.tmp`;
      const stream = fs.createWriteStream(tempPath);

      response.pipe(stream);
      stream.on('finish', () => {
        stream.close(() => {
          fs.renameSync(tempPath, destination);
          resolve();
        });
      });

      stream.on('error', (error) => {
        stream.close(() => {
          try {
            fs.unlinkSync(tempPath);
          } catch (_ignore) {}
          reject(error);
        });
      });
    });

    request.on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Downloading English OCR model to: ${OUTPUT_FILE}`);
  await download(MODEL_URL, OUTPUT_FILE);
  const sizeMb = (fs.statSync(OUTPUT_FILE).size / (1024 * 1024)).toFixed(2);
  console.log(`Done. Saved ${sizeMb} MB`);
}

main().catch((error) => {
  console.error(`OCR download error: ${error.message}`);
  process.exitCode = 1;
});
