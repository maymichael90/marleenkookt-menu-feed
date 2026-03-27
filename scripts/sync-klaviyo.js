const fetch = require('node-fetch');

const KLAVIYO_API_KEY = 'pk_xxxx'; // jouw private key
const FEED_API_URL = 'https://jouwdomain.vercel.app/api/menu'; // jouw feed endpoint

async function syncToKlaviyo() {
  // 1. Haal jouw feed op
  const res = await fetch(FEED_API_URL);
  const meals = await res.json();

  // 2. Push elk gerecht als Catalog item naar Klaviyo
  for (const meal of meals) {
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
            external_id: meal.id,
            title:       meal.title,
            description: meal.description,
            url:         meal.link,
            image_full_url: meal.image_link,
            price:       meal.price,
            custom_metadata: {
              day:      meal.day,
              category: meal.category,
              date:     meal.date
            }
          }
        }
      })
    });
  }
  console.log(`${meals.length} maaltijden gesynchroniseerd naar Klaviyo`);
}

syncToKlaviyo();
