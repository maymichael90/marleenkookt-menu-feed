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

function fetchXML(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Super-robuuste tag extractor. 
 * Zoekt naar <tag...>inhoud</tag> en filtert CDATA en HTML entiteiten.
 */
function getTag(str, tag) {
  // Deze regex is minder streng en pakt alles tussen de tags
  const re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i');
  const m = str.match(re);
  if (!m || !m[1]) return '';

  return m[1]
    .replace(/<!\[CDATA\[/gi, '') // Verwijder CDATA start
    .replace(/\]\]>/gi, '')      // Verwijder CDATA eind
    .replace(/&amp;/g, '&')
    .replace(/&#x20AC;/g, '€')
    .replace(/&#xA0;/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function parseProducts(xml, fromDate) {
  const products = [];
  // Split de XML in producten op basis van de <product> tag
  const productChunks = xml.split(/<product\s+/i).slice(1);

  for (let chunk of productChunks) {
    // Haal de SKU uit de openings-tag (bijv. sku="MKM123")
    const skuMatch = chunk.match(/sku="([^"]+)"/i);
    const sku = skuMatch ? skuMatch[1] : '';
    
    const date = getTag(chunk, 'date');
    if (!date || date < fromDate) continue;

    const isMain    = getTag(chunk, 'is_main_course');
    const isVisible = getTag(chunk, 'is_visible_in_menu');
    
    // Check of het een hoofdgerecht is en zichtbaar
    if (isMain !== '1' || isVisible !== '1') continue;

    const type = getTag(chunk, 'type');
    if (SKIP_TYPES.includes(type)) continue;

    // MARLEENKOOKT SPECIFIEK: De titel zit in <n>
    let name = getTag(chunk, 'n');
    
    // Fallback: als <n> leeg is, probeer <name>
    if (!name) name = getTag(chunk, 'name');

    products.push({
      date,
      sku,
      name,
      url:         getTag(chunk, 'url'),
      image_url:   getTag(chunk, 'image_url'),
      price:       getTag(chunk, 'price'),
      description: getTag(chunk, 'description'),
      type,
    });
  }

  return products;
}

function pickFour(products) {
  const byDate = {};
  for (const p of products) {
    if (!byDate[p.date]) byDate[p.date] = [];
    byDate[p.date].push(p);
  }
  
  const dates = Object.keys(byDate).sort();
  const picked = [];
  const usedSkus = new Set();

  for (const date of dates) {
    if (picked.length >= 4) break;
    const day = byDate[date];
    
    // Pak 1 vlees/vis en 1 vega per dag voor maximale variatie
    const meat = day.find(p => MEAT_TYPES.includes(p.type) && !usedSkus.has(p.sku));
    if (meat && picked.length < 4) { 
        picked.push(meat); 
        usedSkus.add(meat.sku); 
    }
    
    const veg = day.find(p => VEG_TYPES.includes(p.type) && !usedSkus.has(p.sku));
    if (veg && picked.length < 4) { 
        picked.push(veg); 
        usedSkus.add(veg.sku); 
    }
  }

  // Vul aan tot 4 als we er nog niet zijn
  if (picked.length < 4) {
    for (const p of products) {
      if (picked.length >= 4) break;
      if (!usedSkus.has(p.sku)) { 
          picked.push(p); 
          usedSkus.add(p.sku); 
      }
    }
  }
  return picked.slice(0, 4);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const monday   = getNextMonday();
    const fromDate = toYMD(monday);

    const xml      = await fetchXML(FEED_URL);
    
    // Als de XML niet geladen kan worden
    if (!xml) throw new Error("Empty XML response");

    const products = parseProducts(xml, fromDate);
    const four     = pickFour(products);

    const items = four.map((p, i) => ({
      id:          p.sku || 'item-' + i,
      title:       p.name || 'Naamloos gerecht', // Fallback voor display
      description: p.description,
      url:         p.url,
      image_url:   p.image_url,
      price:       parseFloat(p.price) || 0,
      custom_metadata: {
        type:    p.type,
        type_nl: TYPE_NL[p.type] || p.type,
        date:    p.date,
      }
    }));

    res.status(200).json({ items });

  } catch (err) {
    console.error("Feed Error:", err.message);
    res.status(500).json({ error: 'Error fetching menu feed', details: err.message });
  }
};
