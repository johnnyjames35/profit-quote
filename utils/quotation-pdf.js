const {chromium}=require('playwright-core');
let active=0;
// Bound process memory; each render owns and closes its browser, including on failure.
async function renderPDF(html){
  if(active>=2) throw Object.assign(new Error('PDF service is busy. Please try again in a moment.'),{status:503});
  active++;
  let browser;
  try{
    let options={headless:true,timeout:20000};
    if(process.env.PQ_BROWSER_PATH) options.executablePath=process.env.PQ_BROWSER_PATH;
    else if(process.platform==='linux'){
      const bundled=require('@sparticuz/chromium');
      options={...options,args:bundled.args,executablePath:await bundled.executablePath()};
    }
    browser=await chromium.launch(options);
    const context=await browser.newContext({javaScriptEnabled:false,locale:'en-GB'});
    // The document is entirely self-contained; never fetch user-supplied URLs.
    await context.route('**/*',route=>route.abort());
    const page=await context.newPage();
    page.setDefaultTimeout(15000);
    await page.setContent(html,{waitUntil:'load'});
    return await page.pdf({format:'A4',printBackground:true,displayHeaderFooter:false,margin:{top:'10mm',bottom:'10mm',left:'10mm',right:'10mm'},timeout:15000});
  }finally{
    try{if(browser) await browser.close();}finally{active--;}
  }
}
module.exports={renderPDF};
