const fetch = require('node-fetch');

const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;
const FEED_API_URL = 'https://marleenkookt-menu-feed.vercel.app/api/feed';
const CATALOG_ID = '79729'; // vul jouw catalog ID in

async function upsertMeal(meal) {
  // Probeer eerst te updaten (PATCH)
  const patch = await fetch(
    `https://a.klaviyo.com/api/catalog-items/${meal.id}/`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        'revision': '2024-02-15',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data: {
          type: 'catalog-item',
          id: meal.id,
          attributes: {
            title:          meal.title,
            description:    meal.description,
            url:            meal.link,
            image_full_url: meal.image_link,
            price:          meal.price,
            custom_metadata: {
              day:      meal.day,
              category: meal.category,
              date:     meal.date
            }
          }
        }
      })
    }
  );

  // Als het item nog niet bestaat → aanmaken via POST
  if (patch.status === 404) {
    await fetch('https://a.klaviyo.com/api/catalog-items/', {
      method: 'POST',
      headers: {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        'revision': '2024-02-15',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data: {
          type: 'catalog-item',
          attributes: {
            external_id:    meal.id,
            catalog_type:   '$default',
            title:          meal.title,
            description:    meal.description,
            url:            meal.link,
            image_full_url: meal.image_link,
            price:          meal.price,
            custom_metadata: {
              day:      meal.day,
              category: meal.category,
              date:     meal.date
            }
          }
        }
      })
    });
    console.log(`Aangemaakt: ${meal.title}`);
  } else {
    console.log(`Bijgewerkt:  ${meal.title}`);
  }
}

async function syncToKlaviyo() {
  try {
    const res   = await fetch(FEED_API_URL);
    const meals = await res.json();

    for (const meal of meals) {
      await upsertMeal(meal);
    }

    console.log(`Klaar — ${meals.length} maaltijden gesynchroniseerd`);
  } catch (err) {
    console.error('Sync mislukt:', err.message);
    process.exit(1);
  }
}

syncToKlaviyo();
