const https = require('https');

const FEED_URL   = 'https://www.marleenkookt.nl/menu/feed/xml';
const MEAT_TYPES = ['meat', 'fish', 'exclusive'];
const VEG_TYPES  = ['vegetarian', 'bowl'];
const SKIP_TYPES = ['kids', 'soup', 'dessert', 'breakfast'];

// Automatically calculate next Monday
function getNextMonday() {
  const d = new Date();
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? 1 : (8 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10); // returns "YYYY-MM-DD"
}

function extract(str, tag) {
  const startTag = '<' + tag + '>';
  const endTag   = '</' + tag + '>';
  const start = str.indexOf(startTag);
  if (start === -1) return '';
  const end = str.indexOf(endTag, start);
  if (end === -1) return '';
  return str.substring(start + startTag.length, end)
    .replace(/<!\[CDATA\[/gi, '').replace(/\]\]>/gi, '')
    .replace(/&amp;/g, '&').replace(/&#x20AC;/g, '€').replace(/&#xA0;/g, ' ')
    .trim();
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  try {
    const fromDate = getNextMonday();

    const xml = await new Promise((resolve, reject) => {
      https.get(FEED_URL, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => resolve(body));
      }).on('error', reject);
    });

    // Parse all products from next Monday onwards
    const allProducts = [];
    const rawItems = xml.split('<product ');

    for (let i = 1; i < rawItems.length; i++) {
      const item = rawItems[i];
      const itemDate = extract(item, 'date');
      if (!itemDate || itemDate < fromDate) continue;
      if (extract(item, 'is_main_course') !== '1') continue;
      if (extract(item, 'is_visible_in_menu') !== '1') continue;

      const type = extract(item, 'type');
      if (SKIP_TYPES.includes(type)) continue;

      const skuMatch = item.match(/sku="([^"]+)"/);
      const sku = skuMatch ? skuMatch[1] : 'MKM-' + i;

      allProducts.push({
        sku,
        date: itemDate,
        type,
        unique_id:   sku,
        title:       extract(item, 'n'),
        description: extract(item, 'description').substring(0, 200),
        link:        extract(item, 'url'),
        image_link:  extract(item, 'image_url'),
        price:       parseFloat(extract(item, 'price')) || 13.50,
      });
    }

    // Pick 4: 1 meat + 1 veg per day, no duplicate SKUs
    const byDate = {};
    for (const p of allProducts) {
      if (!byDate[p.date]) byDate[p.date] = [];
      byDate[p.date].push(p);
    }

    const picked   = [];
    const usedSkus = new Set();

    for (const date of Object.keys(byDate).sort()) {
      if (picked.length >= 4) break;
      const day  = byDate[date];
      const meat = day.find(p => MEAT_TYPES.includes(p.type) && !usedSkus.has(p.sku));
      const veg  = day.find(p => VEG_TYPES.includes(p.type)  && !usedSkus.has(p.sku));
      if (meat && picked.length < 4) { picked.push(meat); usedSkus.add(meat.sku); }
      if (veg  && picked.length < 4) { picked.push(veg);  usedSkus.add(veg.sku);  }
    }

    // Klaviyo requires { items: [...] }
    const items = picked.map(p => ({
      unique_id:   p.unique_id,
      title:       p.title,
      description: p.description,
      link:        p.link,
      image_link:  p.image_link,
      price:       p.price,
    }));

    res.status(200).json({ items });

  } catch (err) {
    res.status(500).json({ error: 'Fetch failed', message: err.message });
  }
};
