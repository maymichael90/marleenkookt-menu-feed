const https = require('https');

const FEED_URL = 'https://www.marleenkookt.nl/menu/feed/xml';

// Hulpmiddel om tekst tussen specifieke XML-tags uit te trekken
function extract(str, startTag, endTag) {
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
  // Klaviyo heeft JSON nodig, geen XML
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // 1. Haal de ruwe XML op
    const xml = await new Promise((resolve, reject) => {
      https.get(FEED_URL, (response) => {
        let body = '';
        response.on('data', (chunk) => body += chunk);
        response.on('end', () => resolve(body));
      }).on('error', reject);
    });

    // 2. Bepaal de datum van volgende maandag
    const d = new Date();
    d.setDate(d.getDate() + (d.getDay() === 0 ? 1 : 8 - d.getDay()));
    const targetDate = d.toISOString().slice(0, 10);

    // 3. Knip de XML op in losse producten
    const products = [];
    const rawItems = xml.split('<product ');

    for (let i = 1; i < rawItems.length; i++) {
      const item = rawItems[i];
      const itemDate = extract(item, '<date>', '</date>');

      // Filter: Alleen hoofdgerechten vanaf volgende maandag
      if (itemDate >= targetDate && extract(item, '<is_main_course>', '</is_main_course>') === '1') {
        
        // SKU uit de attribuut vissen
        const skuMatch = item.match(/sku="([^"]+)"/);
        
        products.push({
          id: skuMatch ? skuMatch[1] : 'MKM-' + i,
          title: extract(item, '<n>', '</n>') || extract(item, '<name>', '</name>'),
          description: extract(item, '<description>', '</description>').substring(0, 250) + '...',
          link: extract(item, '<url>', '</url>'),
          image_link: extract(item, '<image_url>', '</image_url>'),
          price: extract(item, '<price>', '</price>'),
          metadata: { date: itemDate }
        });

        // Stop bij 10 items om de feed snel en klein te houden voor Klaviyo
        if (products.length >= 10) break;
      }
    }

    // 4. Stuur de data terug
    res.status(200).json(products);

  } catch (err) {
    res.status(500).json({ error: "Crash voorkomen", message: err.message });
  }
};
