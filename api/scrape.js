const { chromium } = require('playwright');

let browser = null;
let page = null;

module.exports = async (req, res) => {
  // CORS headers
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

    // Initialize browser if not already done
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
    
    // Try to restart browser on error
    try {
      await restartBrowser();
    } catch (restartError) {
      console.error('❌ Restart failed:', restartError.message);
    }

    return res.status(500).json({
      error: 'Chat failed',
      details: error.message,
      query: message
    });
  }
};

// Initialize browser and navigate to Bing AI Chat
async function initializeBrowser() {
  console.log('🚀 Initializing browser...');
  
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
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  page = await context.newPage();

  // Navigate to Bing AI Chat
  console.log('🌐 Navigating to Bing AI Chat...');
  await page.goto('https://www.bing.com/search?q=Bing+AI&showconv=1&FORM=hpcodx', {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  // Wait for page to load
  await page.waitForTimeout(3000);
  
  console.log('✅ Browser initialized');
}

// Get input text area
async function getInputBox() {
  return await page.waitForSelector('.text-area', { timeout: 10000 });
}

// Check if we're logged in (input box exists)
async function isLoggedIn() {
  try {
    await page.waitForSelector('.text-area', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// Check if response is still loading
async function isLoadingResponse() {
  try {
    const stopButton = await page.$('.stop');
    if (stopButton) {
      return await stopButton.isEnabled();
    }
    return false;
  } catch {
    return false;
  }
}

// Send message to Bing AI
async function sendMessage(message) {
  console.log('📝 Sending message...');
  
  const inputBox = await getInputBox();
  await inputBox.click();
  await inputBox.fill(message);
  await inputBox.press('Enter');
  
  console.log('✅ Message sent');
}

// Get the latest response from Bing AI
async function getLastMessage() {
  console.log('⏳ Waiting for response...');
  
  // Wait for response to complete
  let attempts = 0;
  const maxAttempts = 60; // 15 seconds max wait
  
  while (attempts < maxAttempts) {
    const loading = await isLoadingResponse();
    if (!loading) break;
    
    await page.waitForTimeout(250);
    attempts++;
  }

  // Get all message elements
  const messageElements = await page.$$("div[class*='ac-textBlock']");
  
  if (messageElements.length === 0) {
    throw new Error('No messages found');
  }

  // Get the last message (AI response)
  const lastElement = messageElements[messageElements.length - 1];
  const responseText = await lastElement.innerText();
  
  console.log('✅ Response received');
  return responseText;
}

// Send message and get response with new topic handling
async function sendMessageAndGetResponse(message) {
  // Check if logged in
  if (!(await isLoggedIn())) {
    throw new Error('Not logged in to Bing AI Chat');
  }

  // Send message
  await sendMessage(message);
  
  // Get response
  let response = await getLastMessage();

  // Handle "new topic" requirement
  if (response.toLowerCase().includes('new topic')) {
    console.log('🔄 New topic required, clicking button...');
    
    try {
      const newTopicButton = await page.waitForSelector("button[aria-label='New topic']", { timeout: 5000 });
      await newTopicButton.click();
      
      // Wait a moment for the new topic to initialize
      await page.waitForTimeout(2000);
      
      // Send message again
      await sendMessage(message);
      response = await getLastMessage();
      
    } catch (error) {
      console.log('⚠️ Could not click new topic button:', error.message);
    }
  }

  return response;
}

// Restart browser (for error recovery)
async function restartBrowser() {
  console.log('🔄 Restarting browser...');
  
  if (page) {
    try {
      await page.close();
    } catch (e) {
      console.log('Warning: Error closing page:', e.message);
    }
  }
  
  if (browser) {
    try {
      await browser.close();
    } catch (e) {
      console.log('Warning: Error closing browser:', e.message);
    }
  }
  
  browser = null;
  page = null;
  
  // Wait before reinitializing
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  await initializeBrowser();
  console.log('✅ Browser restarted');
}

// Cleanup on process exit
process.on('exit', async () => {
  if (browser) {
    await browser.close();
  }
});
