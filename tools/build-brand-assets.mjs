import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

// 1. Ensure docs/brand directory
fs.mkdirSync('docs/brand', { recursive: true });

// Copy Brand Guide files
fs.copyFileSync(
  'C:/Users/jyoti/.t3/userdata/attachments/6eb423c6-3692-4514-b07d-791e7b4b4a2d-1e85db70-10b8-44cb-86cc-983da77664f0-pdf.pdf',
  'docs/brand/FCS_Branding_Guide_v1.0.pdf'
);
fs.copyFileSync(
  'C:/Users/jyoti/.t3/userdata/attachments/6eb423c6-3692-4514-b07d-791e7b4b4a2d-e34818b3-ce5d-4bc6-8cf6-4300209e6961-docx.docx',
  'docs/brand/FCS_Branding_Guide_v1.0.docx'
);
console.log('Copied Brand Guide PDF and DOCX to docs/brand/');

// Copy InkScapeDesignBoard.svg
fs.copyFileSync(
  'C:/Users/jyoti/Downloads/InkScapeDesignBoard.svg',
  'assets/InkScapeDesignBoard.svg'
);

// Copy logoicon.svg
let logoicon = fs.readFileSync('C:/Users/jyoti/Downloads/logoicon.svg', 'utf8');
fs.writeFileSync('assets/logoicon.svg', logoicon, 'utf8');

// Copy logoWtype.svg
let logoWtype = fs.readFileSync('C:/Users/jyoti/Downloads/logoWtype.svg', 'utf8');
// Expand viewBox width slightly to prevent font clipping at edge if needed
// Original viewBox was 0 0 119.0868 61.535973, bounding box extends to 123.7
logoWtype = logoWtype.replace('viewBox="0 0 119.0868 61.535973"', 'viewBox="0 0 126 62"');
logoWtype = logoWtype.replace('width="119.0868mm"', 'width="126mm"');
fs.writeFileSync('assets/logoWtype.svg', logoWtype, 'utf8');

// Copy logoWtype2.svg
let logoWtype2 = fs.readFileSync('C:/Users/jyoti/Downloads/logoWtype2.svg', 'utf8');
// Original viewBox was 0 0 105.33909 74.996506, text extends to 105.5 x 76
logoWtype2 = logoWtype2.replace('viewBox="0 0 105.33909 74.996506"', 'viewBox="0 0 106 77"');
logoWtype2 = logoWtype2.replace('width="105.33909mm"', 'width="106mm"');
logoWtype2 = logoWtype2.replace('height="74.996506mm"', 'height="77mm"');
fs.writeFileSync('assets/logoWtype2.svg', logoWtype2, 'utf8');

// Copy image.png to assets/fcs-lockup.png
fs.copyFileSync(
  'C:/Users/jyoti/.t3/userdata/attachments/6eb423c6-3692-4514-b07d-791e7b4b4a2d-17a42f36-69df-44fa-a8ac-cfa67bd4f5d1.png',
  'assets/fcs-lockup.png'
);
console.log('Saved master SVGs and fcs-lockup.png to assets/');

// 2. Generate crisp favicons & high-res mark PNGs from logoicon.svg using Playwright
const browser = await chromium.launch({ channel: 'msedge' });

async function renderIcon(size, outputPath) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  
  const svgContent = fs.readFileSync('assets/logoicon.svg', 'utf8');
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          html, body {
            margin: 0;
            padding: 0;
            width: ${size}px;
            height: ${size}px;
            overflow: hidden;
            background: transparent;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          svg {
            width: 100%;
            height: 100%;
            display: block;
          }
        </style>
      </head>
      <body>
        ${svgContent}
      </body>
    </html>
  `);
  
  await page.screenshot({
    path: outputPath,
    omitBackground: true,
  });
  await page.close();
  console.log(`Generated ${outputPath} (${size}x${size})`);
}

await renderIcon(32, 'assets/favicon-32.png');
await renderIcon(192, 'assets/favicon-192.png');
await renderIcon(512, 'assets/favicon-512.png');
await renderIcon(1024, 'assets/fcs-mark-large.png');
await renderIcon(696, 'assets/fcs-mark.png');

await browser.close();
console.log('Brand asset compilation complete!');
