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

function getNextMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 1 : (8 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  try {
    const targetDate = getNextMonday();

    const xml = await new Promise((resolve, reject) => {
      https.get(FEED_URL, (response) => {
        let body = '';
        response.on('data', (chunk) => body += chunk);
        response.on('end', () => resolve(body));
      }).on('error', reject);
    });

    // Exact same split method as working version
    const products = [];
    const usedSkus = new Set();
    const byDate = {};

    const rawItems = xml.split('<product ');
    for (let i = 1; i < rawItems.length; i++) {
      const item = rawItems[i];
      const itemDate = extract(item, 'date');
      if (!itemDate || itemDate < targetDate) continue;
      if (extract(item, 'is_main_course') !== '1') continue;
      if (extract(item, 'is_visible_in_menu') !== '1') continue;

      const type = extract(item, 'type');
      if (['kids','soup','dessert','breakfast'].includes(type)) continue;

      const skuMatch = item.match(/sku="([^"]+)"/);
      const sku = skuMatch ? skuMatch[1] : 'MKM-' + i;

      if (!byDate[itemDate]) byDate[itemDate] = [];
      byDate[itemDate].push({
        sku,
        date: itemDate,
        type,
        id:          sku,
        title:       extract(item, 'n') || extract(item, 'name'),
        description: extract(item, 'description').substring(0, 200),
        link:        extract(item, 'url'),
        image_link:  extract(item, 'image_url'),
        price:       parseFloat(extract(item, 'price')) || 13.50,
        category:    "menu_volgende_week"
      });
    }

    // Pick 1 meat + 1 veg per day, max 4 total, no duplicate SKUs
    for (const date of Object.keys(byDate).sort()) {
      if (products.length >= 4) break;
      const day = byDate[date];
      const meat = day.find(p => ['meat','fish','exclusive'].includes(p.type) && !usedSkus.has(p.sku));
      const veg  = day.find(p => ['vegetarian','bowl'].includes(p.type) && !usedSkus.has(p.sku));
      if (meat && products.length < 4) { products.push(meat); usedSkus.add(meat.sku); }
      if (veg  && products.length < 4) { products.push(veg);  usedSkus.add(veg.sku); }
    }

    // Klaviyo: direct array of dicts
    res.status(200).json(products.map(p => ({
      id:          p.id,
      title:       p.title,
      description: p.description,
      link:        p.link,
      image_link:  p.image_link,
      price:       p.price,
      category:    p.category
    })));

  } catch (err) {
    res.status(500).json({ error: 'Fetch failed', message: err.message });
  }
};
