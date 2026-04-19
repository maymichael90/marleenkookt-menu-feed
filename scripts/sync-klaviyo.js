const https = require('https');

const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;
const FEED_API_URL    = 'https://marleenkookt-menu-feed.vercel.app/api/feed';

function klaviyoRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'a.klaviyo.com',
      path,
      method,
      headers: {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        'revision':      '2024-02-15',
        'Content-Type':  'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

// ── Delete ALL existing items ──────────────────────────
async function deleteAllItems() {
  let cursor = null;
  let total = 0;
  do {
    const path = cursor
      ? `/api/catalog-items/?page[cursor]=${cursor}`
      : '/api/catalog-items/';
    const res  = await klaviyoRequest('GET', path, null);
    const data = JSON.parse(res.body);
    if (!data.data || data.data.length === 0) break;
    for (const item of data.data) {
      const del = await klaviyoRequest('DELETE', `/api/catalog-items/${item.id}/`, null);
      if (del.status === 204) { total++; }
    }
    cursor = data.links?.next
      ? new URL(data.links.next).searchParams.get('page[cursor]')
      : null;
  } while (cursor);
  console.log(`🗑️  ${total} oude items verwijderd`);
}

// ── Ensure category exists ─────────────────────────────
const categoryCache = {};

async function ensureCategory(name) {
  if (categoryCache[name]) return categoryCache[name];
  const extId = `mk-cat-${name}`;

  const res = await klaviyoRequest('POST', '/api/catalog-categories/', {
    data: {
      type: 'catalog-category',
      attributes: { external_id: extId, catalog_type: '$default', name }
    }
  });

  let realId;
  if (res.status === 201) {
    realId = JSON.parse(res.body).data.id;
    console.log(`📁 Category aangemaakt: ${name}`);
  } else if (res.status === 409) {
    const id  = `$custom:::$default:::${extId}`;
    const get = await klaviyoRequest('GET', `/api/catalog-categories/${id}/`, null);
    realId = get.status === 200 ? JSON.parse(get.body).data.id : null;
    console.log(`📁 Category bestaat: ${name}`);
  } else {
    console.warn(`⚠️  Category fout (${res.status}): ${name}`);
    return null;
  }

  categoryCache[name] = realId;
  return realId;
}

// ── Create item ────────────────────────────────────────
async function createItem(meal) {
  const post = await klaviyoRequest('POST', '/api/catalog-items/', {
    data: {
      type: 'catalog-item',
      attributes: {
        external_id:  meal.id,
        catalog_type: '$default',
        title:        meal.title,
        description:  meal.description,
        url:          meal.link,
        image_full_url: meal.image_link,
        price:        meal.price,
        published:    true,
        custom_metadata: {
          day:  meal.condition || '',
          date: meal.date || '',
          week: meal.week || '',
        }
      }
    }
  });

  if (post.status === 201) {
    const realId = JSON.parse(post.body).data.id;
    console.log(`✅ Aangemaakt: ${meal.title} [${meal.google_product_category}]`);
    return realId;
  } else {
    console.warn(`⚠️  Aanmaken fout (${post.status}): ${meal.title}`);
    console.warn(post.body);
    return null;
  }
}

// ── Link item to category ──────────────────────────────
async function linkToCategory(itemId, catId) {
  if (!itemId || !catId) return;
  const res = await klaviyoRequest(
    'POST',
    `/api/catalog-categories/${catId}/relationships/items/`,
    { data: [{ type: 'catalog-item', id: itemId }] }
  );
  if (res.status === 204 || res.status === 200 || res.status === 409) {
    console.log(`🔗 Gekoppeld`);
  } else {
    console.warn(`⚠️  Koppelen fout (${res.status}): ${res.body}`);
  }
}

// ── Main ───────────────────────────────────────────────
async function syncToKlaviyo() {
  try {
    console.log('🗑️  Oude items verwijderen...');
    await deleteAllItems();

    console.log('\n📡 Feed ophalen...');
    const meals = await httpGet(FEED_API_URL);
    console.log(`📋 ${meals.length} maaltijden gevonden\n`);

    for (const meal of meals) {
      const catName = meal.google_product_category || 'menu_volgende_week';
      const catId   = await ensureCategory(catName);
      const itemId  = await createItem(meal);
      await linkToCategory(itemId, catId);
      console.log('---');
    }

    console.log(`
✅ Klaar — ${meals.length} maaltijden gesynchroniseerd`);
    await refreshProductFeeds();
    console.log('\nCategories beschikbaar:');
    console.log('  • menu_deze_week');
    console.log('  • menu_volgende_week');
    console.log('  • kids_deze_week');
    console.log('  • kids_volgende_week');

  } catch (err) {
    console.error('❌ Sync mislukt:', err.message);
    process.exit(1);
  }
}

syncToKlaviyo();

// ── Refresh Klaviyo Product Feeds ─────────────────────
async function refreshProductFeeds() {
  const feedIds = ['8352644']; // voeg meer IDs toe indien nodig
  for (const feedId of feedIds) {
    const res = await klaviyoRequest(
      'POST',
      `/api/product-feeds/${feedId}/refresh/`,
      null
    );
    if (res.status === 200 || res.status === 202 || res.status === 204) {
      console.log(`🔄 Product Feed ${feedId} ververst`);
    } else {
      console.warn(`⚠️  Feed refresh fout (${res.status}): ${res.body}`);
    }
  }
}
