const puppeteer = require('puppeteer');

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

  let browser;
  try {
    console.log(`Processing query: ${query}`);
    
    // Launch browser with explicit Chrome path and serverless-optimized settings
    browser = await puppeteer.launch({
      headless: true,
      // Use system Chrome if available, fallback to bundled
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 
                     '/usr/bin/google-chrome-stable' || 
                     '/usr/bin/google-chrome' || 
                     undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection'
      ]
    });
    
    const page = await browser.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ width: 1200, height: 800 });
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
        source: 'puppeteer',
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
    
    // If Chrome not found, provide helpful error
    if (error.message.includes('Could not find Chrome')) {
      return res.status(500).json({ 
        error: 'Chrome browser not available',
        message: 'Chrome installation failed. This may be due to Vercel build constraints.',
        details: error.message,
        solution: 'Try redeploying or contact support if issue persists',
        query: query
      });
    }
    
    return res.status(500).json({ 
      error: 'Scraping failed', 
      details: error.message,
      query: query,
      timestamp: new Date().toISOString()
    });
    
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error('Error closing browser:', closeError.message);
      }
    }
  }
};
