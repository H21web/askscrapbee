const fetch = require('node-fetch');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { query } = req.query;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter missing' });
  }

  const url = `https://iask.ai/q?mode=question&options[detail_level]=concise&q=${encodeURIComponent(query)}`;
  
  for (let attempt = 1; attempt <= 6; attempt++) {
    console.log(`Attempt ${attempt}: Looking for first paragraph...`);
    
    if (attempt > 1) {
      await sleep(2500);
    }
    
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (!response.ok) continue;
      
      const html = await response.text();
      const paragraph = getFirstParagraphOnly(html);
      
      if (paragraph && paragraph.length >= 30) {
        return res.status(200).json({
          success: true,
          text: paragraph,
          query: query,
          attempt: attempt,
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      console.log(`Attempt ${attempt} failed:`, error.message);
    }
  }
  
  return res.status(404).json({
    error: 'No paragraph found',
    message: 'Could not find a clean first paragraph',
    query: query
  });
};

// Extract ONLY the first actual content paragraph
function getFirstParagraphOnly(html) {
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    
    // Find the output div
    const outputDiv = doc.querySelector('#output');
    if (!outputDiv) return null;
    
    // REMOVE all unwanted elements completely
    const junkSelectors = [
      'style', 'script', 'button', 'a', 
      '.spinner', '[class*="spinner"]', 
      '[class*="share"]', '[class*="email"]',
      'sup', 'sub', 'cite'
    ];
    
    junkSelectors.forEach(selector => {
      outputDiv.querySelectorAll(selector).forEach(el => el.remove());
    });
    
    // Look for the FIRST actual paragraph with content
    const paragraphs = outputDiv.querySelectorAll('p');
    
    for (const p of paragraphs) {
      let text = p.textContent || '';
      
      // Skip if it's obviously UI/CSS content
      if (isJunk(text)) continue;
      
      // Clean the paragraph text
      text = cleanParagraph(text);
      
      // If it's substantial and looks like real content, return it
      if (text.length >= 30 && looksLikeContent(text)) {
        console.log(`✅ Found first paragraph: "${text.substring(0, 50)}..."`);
        return text;
      }
    }
    
    // If no <p> tags, try div elements
    const divs = outputDiv.querySelectorAll('div');
    for (const div of divs) {
      let text = div.textContent || '';
      
      if (isJunk(text)) continue;
      
      text = cleanParagraph(text);
      
      if (text.length >= 30 && looksLikeContent(text)) {
        // Extract first sentence/paragraph from div
        const firstSentence = text.split(/[.!?]+/)[0].trim();
        if (firstSentence.length >= 30) {
          return firstSentence + '.';
        }
        return text;
      }
    }
    
    return null;
    
  } catch (error) {
    console.log('Error:', error.message);
    return null;
  }
}

// Check if text is junk (UI/CSS content)
function isJunk(text) {
  if (!text || text.length < 10) return true;
  
  const junkPatterns = [
    /Add Email|Share Answer|Email this answer/i,
    /Provided by iAsk\.ai|Ask AI/i,
    /Thinking\.\.\.|Loading\.\.\.|Please wait/i,
    /spinner|animation|keyframes|transform|cubic-bezier/i,
    /\.[a-zA-Z_]+\{.*\}/,  // CSS classes
    /@keyframes/,
    /animation-delay|translateY/i,
    /^[^a-zA-Z]*$/ // Only symbols/numbers
  ];
  
  return junkPatterns.some(pattern => pattern.test(text));
}

// Clean paragraph text thoroughly
function cleanParagraph(text) {
  if (!text) return '';
  
  // Remove CSS completely
  text = text.replace(/\.[a-zA-Z_][a-zA-Z0-9_]*\{[^}]*\}/g, ''); // .class{...}
  text = text.replace(/@keyframes[^}]*\{[^}]*\}/g, ''); // @keyframes{...}
  text = text.replace(/animation[^;]*;/g, ''); // animation properties
  text = text.replace(/transform[^;]*;/g, ''); // transform properties
  text = text.replace(/cubic-bezier\([^)]*\)/g, ''); // timing functions
  text = text.replace(/translateY?\([^)]*\)/g, ''); // translate functions
  text = text.replace(/animation-delay[^;]*;/g, ''); // animation-delay
  text = text.replace(/spinner_[a-zA-Z0-9]+/g, ''); // spinner classes
  
  // Remove UI text
  text = text.replace(/Add at least one email/gi, '');
  text = text.replace(/Add Email/gi, '');
  text = text.replace(/Email this answer/gi, '');
  text = text.replace(/Share Answer/gi, '');
  text = text.replace(/Provided by iAsk\.ai/gi, '');
  text = text.replace(/Ask AI\.?/gi, '');
  
  // Remove loading states
  text = text.replace(/Thinking\.\.\.|Loading\.\.\.|Please wait/gi, '');
  
  // Remove footnotes and links
  text = text.replace(/\[\d+\]/g, '');
  text = text.replace(/https?:\/\/[^\s]+/g, '');
  
  // Clean whitespace and symbols
  text = text.replace(/\s+/g, ' ');
  text = text.replace(/[–—]+/g, ''); // Remove dashes
  text = text.replace(/^\W+|\W+$/g, ''); // Remove leading/trailing symbols
  text = text.trim();
  
  return text;
}

// Check if text looks like actual content
function looksLikeContent(text) {
  if (!text || text.length < 20) return false;
  
  // Should have normal English words
  const commonWords = ['is', 'are', 'was', 'were', 'the', 'and', 'or', 'but', 'can', 'will', 'this', 'that', 'a', 'an'];
  const hasCommonWords = commonWords.some(word => 
    new RegExp(`\\b${word}\\b`, 'i').test(text)
  );
  
  // Should not be mostly technical terms
  const techRatio = (text.match(/\b(animation|transform|spinner|css|keyframes)\b/gi) || []).length;
  const totalWords = text.split(/\s+/).length;
  const isMostlyTech = techRatio / totalWords > 0.3;
  
  return hasCommonWords && !isMostlyTech;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
