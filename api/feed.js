const https = require('https');

const FEED_URL   = 'https://www.marleenkookt.nl/menu/feed/xml';
const MEAT_TYPES = ['meat', 'fish', 'exclusive'];
const VEG_TYPES  = ['vegetarian', 'bowl'];
const SKIP_TYPES = ['kids', 'soup', 'dessert', 'breakfast'];
const TYPE_NL    = { meat:'Vleesgerecht', fish:'Visgerecht', exclusive:'Exclusief', vegetarian:'Vegetarisch', bowl:'Salade' };

function getNextMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 1 : (8 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toYMD(date) {
  return date.toISOString().slice(0, 10);
}

// Snelle helper om tekst tussen tags te vinden zonder zware regex
function findTag(str, tag) {
  const startTag = `<${tag}>`;
  const endTag = `</${tag}>`;
  const start = str.indexOf(startTag);
  if (start === -1) return '';
  const end = str.indexOf(endTag, start);
  if (end === -1) return '';
  
  return str.substring(start + startTag.length, end)
    .replace(/<!\[CDATA\[/gi, '')
    .replace(/\]\]>/gi, '')
    .replace(/&amp;/g, '&')
    .trim();
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const fromDate = toYMD(getNextMonday());
    
    const xml = await new Promise((resolve, reject) => {
      https.get(FEED_URL, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });

    const products = [];
    const parts = xml.split('<product '); // Efficiënte split
    
    for (let i = 1; i < parts.length; i++) {
      const chunk = parts[i];
      const date = findTag(chunk, 'date');
      
      if (!date || date < fromDate) continue;
      if (findTag(chunk, 'is_main_course') !== '1') continue;
      if (SKIP_TYPES.includes(findTag(chunk, 'type'))) continue;

      const skuMatch = chunk.match(/sku="([^"]+)"/);
      const sku = skuMatch ? skuMatch[1] : 'MKM-' + i;

      // Gebruik <n> tag voor de titel
      let name = findTag(chunk, 'n') || findTag(chunk, 'name');

      products.push({
        id: sku,
        title: name,
        description: findTag(chunk, 'description'),
        link: findTag(chunk, 'url'),
        image_link: findTag(chunk, 'image_url'),
        price: parseFloat(findTag(chunk, 'price')) || 13.50,
        date: date
      });
    }

    // Pak de eerste 4 beschikbare gerechten
    res.status(200).json(products.slice(0, 4));

  } catch (err) {
    res.status(500).json({ error: "Feed Error", message: err.message });
  }
};
