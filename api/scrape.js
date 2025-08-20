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
      usage: 'GET /api/scrape?query=your_question'
    });
  }

  let browser;
  try {
    // Launch browser with specific settings for serverless
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    
    // Set realistic browser headers
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navigate to iask.ai with the query
    const url = `https://iask.ai/q?mode=question&options[detail_level]=concise&q=${encodeURIComponent(query)}`;
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Wait for the output div to be populated with content
    await page.waitForFunction(
      () => {
        const output = document.querySelector('#output');
        return output && output.textContent.trim().length > 20;
      },
      { timeout: 20000 }
    );
    
    // Extract the text content
    const result = await page.evaluate(() => {
      const output = document.querySelector('#output');
      if (!output) return null;
      
      // Clean up the text
      let text = output.textContent.trim();
      
      // Remove extra whitespace
      text = text.replace(/\s+/g, ' ');
      
      return text;
    });
    
    if (result && result.length > 20) {
      res.json({ 
        text: result,
        query: query,
        url: url,
        timestamp: new Date().toISOString(),
        source: 'puppeteer'
      });
    } else {
      res.status(404).json({ 
        error: 'No content found',
        message: 'The output div was empty or contained insufficient content'
      });
    }
    
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ 
      error: 'Scraping failed', 
      details: error.message,
      query: query
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};
