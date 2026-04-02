const https = require('https');

const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;
const FEED_API_URL = 'https://marleenkookt-menu-feed.vercel.app/api/feed';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

function klaviyoRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'a.klaviyo.com',
      path,
      method,
      headers: {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        'revision': '2024-02-15',
        'Content-Type': 'application/json',
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

async function upsertMeal(meal) {
  // Try PATCH first
  const patch = await klaviyoRequest(
    'PATCH',
    `/api/catalog-items/$custom::79729::${meal.id}/`,
    {
      data: {
        type: 'catalog-item',
        id: `$custom::79729::${meal.id}`,
        attributes: {
          title:          meal.title,
          description:    meal.description,
          url:            meal.link,
          image_full_url: meal.image_link,
          price:          meal.price,
          custom_metadata: {
            category: meal.category || meal.google_product_category,
            day:      meal.condition,
            date:     meal.date
          }
        }
      }
    }
  );

  if (patch.status === 404) {
    // Item doesn't exist yet — create it
    await klaviyoRequest(
      'POST',
      '/api/catalog-items/',
      {
        data: {
          type: 'catalog-item',
          attributes: {
            external_id:    meal.id,
            catalog_type:   '$custom',
            catalog_id:     '79729',
            title:          meal.title,
            description:    meal.description,
            url:            meal.link,
            image_full_url: meal.image_link,
            price:          meal.price,
            published:      true,
            custom_metadata: {
              category: meal.category || meal.google_product_category,
              day:      meal.condition,
              date:     meal.date
            }
          }
        }
      }
    );
    console.log(`✅ Aangemaakt: ${meal.title}`);
  } else {
    console.log(`🔄 Bijgewerkt: ${meal.title}`);
  }
}

async function syncToKlaviyo() {
  try {
    console.log('📡 Feed ophalen...');
    const meals = await httpGet(FEED_API_URL);
    console.log(`📋 ${meals.length} maaltijden gevonden`);

    for (const meal of meals) {
      await upsertMeal(meal);
    }

    console.log(`✅ Klaar — ${meals.length} maaltijden gesynchroniseerd`);
  } catch (err) {
    console.error('❌ Sync mislukt:', err.message);
    process.exit(1);
  }
}

syncToKlaviyo();
