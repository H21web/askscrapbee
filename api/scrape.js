const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { query } = req.query;
  
  if (!query) {
    return res.status(400).json({ 
      error: 'Query parameter missing',
      usage: 'GET /api/scrape?query=your_question',
      example: '/api/scrape?query=What is artificial intelligence?'
    });
  }

  let browser = null;
  try {
    console.log(`Processing query: ${query}`);
    
    // Launch browser using @sparticuz/chromium (most reliable for Vercel)
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    
    const page = await browser.newPage();
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36');
    
    // Navigate to iask.ai with the query
    const targetUrl = `https://iask.ai/q?mode=question&options[detail_level]=concise&q=${encodeURIComponent(query)}`;
    console.log(`Navigating to: ${targetUrl}`);
    
    await page.goto(targetUrl, { 
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Wait for the output div to appear and have content
    console.log('Waiting for content to load...');
    await page.waitForFunction(
      () => {
        const output = document.querySelector('#output');
        return output && output.textContent && output.textContent.trim().length > 50;
      },
      { timeout: 25000 }
    );
    
    // Extract the text content
    const result = await page.evaluate(() => {
      const output = document.querySelector('#output');
      if (!output) return null;
      
      // Get all text content and clean it up
      let text = output.textContent || output.innerText || '';
      
      // Remove extra whitespace and clean up
      text = text.replace(/\s+/g, ' ').trim();
      
      // Remove any unwanted prefixes
      text = text.replace(/^(Answer:|Response:|Result:)\s*/i, '');
      
      return text;
    });
    
    console.log(`Extracted text length: ${result ? result.length : 0}`);
    
    if (result && result.length > 20) {
      return res.status(200).json({ 
        success: true,
        text: result,
        query: query,
        url: targetUrl,
        timestamp: new Date().toISOString(),
        source: 'sparticuz-chromium',
        textLength: result.length
      });
    } else {
      return res.status(404).json({ 
        error: 'No content found',
        message: 'The output div was empty or contained insufficient content',
        query: query,
        url: targetUrl
      });
    }
    
  } catch (error) {
    console.error('Scraping error:', error.message);
    
    return res.status(500).json({ 
      error: 'Scraping failed', 
      details: error.message,
      query: query,
      timestamp: new Date().toISOString()
    });
    
  } finally {
    if (browser !== null) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error('Error closing browser:', closeError.message);
      }
    }
  }
};
