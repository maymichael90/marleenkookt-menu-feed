const https = require('https');

// ── Config ──────────────────────────────────────────────
const FEED_URL = 'https://www.marleenkookt.nl/menu/feed/xml';
const MEAT_TYPES = ['meat', 'fish', 'exclusive'];
const VEG_TYPES  = ['vegetarian', 'bowl'];
const SKIP_TYPES = ['kids', 'soup', 'dessert', 'breakfast'];
const DAY_NL     = ['Zondag','Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag'];
const TYPE_NL    = { meat:'Vleesgerecht', fish:'Visgerecht', exclusive:'Exclusief', vegetarian:'Vegetarisch', bowl:'Salade' };
const MONTHS_NL  = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];

// ── Helpers ─────────────────────────────────────────────
function getNextMonday() {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
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

function getTagValue(str, tag) {
  const match = str.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match ? match[1].replace(/&amp;/g,'&').replace(/&#x20AC;/g,'€').replace(/&#xA0;/g,' ').replace(/<!\[CDATA\[|\]\]>/g,'').trim() : '';
}

function parseProducts(xml, fromDate) {
  const products = [];
  const dayBlocks = xml.match(/<day date="([^"]+)"[\s\S]*?<\/day>/g) || [];

  for (const block of dayBlocks) {
    const dateMatch = block.match(/date="([^"]+)"/);
    if (!dateMatch) continue;
    const date = dateMatch[1];
    if (date < fromDate) continue;

    const productBlocks = block.match(/<product sku[\s\S]*?<\/product>/g) || [];
    for (const p of productBlocks) {
      if (getTagValue(p, 'is_main_course') !== '1') continue;
      if (getTagValue(p, 'is_visible_in_menu') !== '1') continue;
      const type = getTagValue(p, 'type');
      if (SKIP_TYPES.includes(type)) continue;
      products.push({
        date,
        name:      getTagValue(p, 'n'),
        url:       getTagValue(p, 'url'),
        image_url: getTagValue(p, 'image_url'),
        type,
      });
    }
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

  for (const date of dates) {
    if (picked.length >= 4) break;
    const day = byDate[date];
    const meat = day.find(p => MEAT_TYPES.includes(p.type));
    const veg  = day.find(p => VEG_TYPES.includes(p.type));
    if (meat && picked.length < 4) picked.push(meat);
    if (veg  && picked.length < 4) picked.push(veg);
  }

  // fallback: fill remaining slots
  if (picked.length < 4) {
    for (const p of products) {
      if (picked.length >= 4) break;
      if (!picked.find(x => x.name === p.name)) picked.push(p);
    }
  }
  return picked.slice(0, 4);
}

function renderCard(p, isLeft) {
  const dow     = new Date(p.date + 'T00:00:00').getDay();
  const dayName = DAY_NL[dow];
  const label   = TYPE_NL[p.type] || p.type;
  const btnColor = p.type === 'exclusive' ? '#561f1e' : '#4a4911';
  const pad = isLeft ? 'padding-right:7px' : 'padding-left:7px';

  return `
    <td width="49%" style="${pad}; vertical-align:top;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff; height:100%;">
        <tr>
          <td style="padding:0; line-height:0; font-size:0;">
            <a href="${p.url}" style="display:block; line-height:0;">
              <img src="${p.image_url}" alt="${p.name}" width="100%"
                   style="display:block; width:100%; height:auto; border:0;" />
            </a>
            <div style="background-color:#561f1e; color:#e9edc9; font-family:Arial,sans-serif;
                        font-size:9px; font-weight:700; letter-spacing:2px;
                        text-transform:uppercase; padding:5px 10px;">${dayName}</div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:16px 14px 10px; vertical-align:top;">
            <div style="font-family:Georgia,'Times New Roman',serif; font-style:italic;
                        font-size:13px; color:#561f1e; margin-bottom:5px;">${label}</div>
            <div style="font-family:Arial,sans-serif; font-size:15px; font-weight:700;
                        color:#4a4911; line-height:1.3;">${p.name}</div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:14px 14px 24px; vertical-align:bottom;">
            <a href="${p.url}"
               style="display:inline-block; background-color:${btnColor}; color:#e9edc9;
                      font-family:Arial,sans-serif; font-size:10px; font-weight:700;
                      letter-spacing:2px; text-transform:uppercase; text-decoration:none;
                      padding:9px 18px;">Bestel &rarr;</a>
          </td>
        </tr>
      </table>
    </td>`;
}

function renderGrid(cards, weekLabel) {
  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#e9edc9;">
<tr><td align="center" style="padding:0 20px;">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px; width:100%;">

  <tr>
    <td align="center" style="padding:0 0 18px;">
      <span style="font-family:Arial,sans-serif; font-size:10px; font-weight:700;
                   letter-spacing:3px; text-transform:uppercase; color:#561f1e;">${weekLabel}</span>
    </td>
  </tr>

  <tr valign="top">
    ${renderCard(cards[0], true)}
    ${renderCard(cards[1], false)}
  </tr>

  <tr><td colspan="2" style="height:14px;"></td></tr>

  <tr valign="top">
    ${renderCard(cards[2], true)}
    ${renderCard(cards[3], false)}
  </tr>

</table>
</td></tr>
</table>`.trim();
}

// ── Handler ─────────────────────────────────────────────
module.exports = async (req, res) => {
  // CORS so Klaviyo can fetch it
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600'); // cache 1 hour

  try {
    const monday   = getNextMonday();
    const fromDate = toYMD(monday);

    // Week label e.g. "24 t/m 28 maart 2026"
    const friday     = new Date(monday); friday.setDate(monday.getDate() + 4);
    const weekLabel  = `${monday.getDate()} t/m ${friday.getDate()} ${MONTHS_NL[friday.getMonth()]} ${friday.getFullYear()}`;

    const xml      = await fetchXML(FEED_URL);
    const products = parseProducts(xml, fromDate);
    const four     = pickFour(products);

    if (four.length < 4) {
      res.setHeader('Content-Type', 'text/html');
      res.status(200).send('<p style="font-family:Arial,sans-serif;color:#4a4911;padding:20px;">Nog geen gerechten beschikbaar voor volgende week.</p>');
      return;
    }

    const html = renderGrid(four, weekLabel);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);

  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching menu feed');
  }
};
