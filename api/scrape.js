const { chromium } = require('playwright-chromium');

let browser = null;
let page = null;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { q: message } = req.query;
  if (!message) {
    return res.status(400).json({ error: 'Missing query parameter "q"' });
  }

  try {
    console.log(`🤖 Processing message: ${message}`);

    // Initialize browser if needed
    if (!browser || !page) {
      await initializeBrowser();
    }

    // Send message and get response
    const response = await sendMessageAndGetResponse(message);

    return res.status(200).json({
      success: true,
      response: response,
      query: message,
      source: 'bing-ai-chat',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error:', error.message);

    return res.status(500).json({
      error: 'Chat failed',
      details: error.message,
      query: message,
      suggestion: 'Try again in a moment'
    });
  }
};

async function initializeBrowser() {
  console.log('🚀 Initializing browser...');
  
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });

    page = await context.newPage();

    console.log('🌐 Navigating to Bing AI Chat...');
    await page.goto('https://www.bing.com/search?q=Bing+AI&showconv=1&FORM=hpcodx', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForTimeout(3000);
    console.log('✅ Browser initialized');

  } catch (error) {
    console.error('❌ Browser initialization failed:', error.message);
    throw new Error(`Browser setup failed: ${error.message}`);
  }
}

async function sendMessageAndGetResponse(message) {
  try {
    // Check for input box
    const inputBox = await page.waitForSelector('.text-area, [placeholder*="ask"], textarea', { 
      timeout: 10000 
    });
    
    if (!inputBox) {
      throw new Error('Chat input not found - might need login');
    }

    console.log('📝 Sending message...');
    await inputBox.click();
    await inputBox.fill(message);
    await inputBox.press('Enter');

    // Wait for response
    console.log('⏳ Waiting for response...');
    await page.waitForTimeout(2000);

    // Look for response elements
    const responseSelectors = [
      "div[class*='ac-textBlock']",
      "[data-testid*='response']", 
      ".response-message",
      "[class*='message'][class*='assistant']"
    ];

    let responseText = '';
    
    for (const selector of responseSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 15000 });
        const elements = await page.$$(selector);
        
        if (elements.length > 0) {
          const lastElement = elements[elements.length - 1];
          responseText = await lastElement.innerText();
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!responseText) {
      throw new Error('No response received from Bing AI');
    }

    console.log('✅ Response received');
    return responseText.trim();

  } catch (error) {
    console.error('❌ Chat interaction failed:', error.message);
    throw error;
  }
}

// Cleanup
process.on('exit', async () => {
  if (browser) {
    await browser.close();
  }
});
