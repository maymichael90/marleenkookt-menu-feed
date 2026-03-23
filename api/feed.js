const https = require('https');

const FEED_URL = 'https://www.marleenkookt.nl/menu/feed/xml';

function extract(str, tag) {
  const startTag = `<${tag}>`;
  const endTag = `</${tag}>`;
  const start = str.indexOf(startTag);
  if (start === -1) return '';
  const end = str.indexOf(endTag, start);
  if (end === -1) return '';
  return str.substring(start + startTag.length, end)
    .replace(/<!\[CDATA\[/gi, '').replace(/\]\]>/gi, '')
    .replace(/&amp;/g, '&').replace(/&#x20AC;/g, '€')
    .trim();
}

module.exports = async (req, res) => {
  // Forceer JSON output
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const xml = await new Promise((resolve, reject) => {
      https.get(FEED_URL, (response) => {
        let body = '';
        response.on('data', (chunk) => body += chunk);
        response.on('end', () => resolve(body));
      }).on('error', reject);
    });

    // Datum voor volgende maandag (vandaag is 23 maart 2026)
    const targetDate = "2026-03-30"; 

    const products = [];
    const rawItems = xml.split('<product ');

    for (let i = 1; i < rawItems.length; i++) {
      const item = rawItems[i];
      const itemDate = extract(item, 'date');

      if (itemDate >= targetDate && extract(item, 'is_main_course') === '1') {
        const skuMatch = item.match(/sku="([^"]+)"/);
        
        products.push({
          unique_id: skuMatch ? skuMatch[1] : 'MKM-' + i,
          title: extract(item, 'n') || extract(item, 'name'),
          description: extract(item, 'description').substring(0, 200),
          link: extract(item, 'url'),
          image_link: extract(item, 'image_url'),
          price: parseFloat(extract(item, 'price')) || 13.50
        });

        if (products.length >= 10) break;
      }
    }

    res.status(200).json(products);

  } catch (err) {
    res.status(500).json({ error: "Fetch failed", message: err.message });
  }
};
