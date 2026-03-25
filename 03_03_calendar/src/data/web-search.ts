import type { WebSearchEntry } from '../types.js';

export const searchEntries: WebSearchEntry[] = [
  {
    keywords: ['italian', 'restaurant', 'podgórze', 'near office', 'trattoria'],
    results: [
      {
        title: 'Trattoria Milano — Authentic Italian in Podgórze',
        url: 'https://trattoria-milano.pl',
        snippet:
          'Cozy Italian restaurant on ul. Limanowskiego 24. Handmade pasta, wood-fired pizza, ' +
          'excellent vegetarian options. Lunch menu 35–55 zł. Open daily from 11:00.',
      },
      {
        title: 'Trattoria Milano – Google Maps Reviews (4.6★)',
        url: 'https://maps.google.com/trattoria-milano-krakow',
        snippet:
          '4.6 out of 5 stars, 820 reviews. "Best carbonara in Kraków." "Great lunch spot near Podgórze." ' +
          '"Vegetarian risotto is amazing." Reservations recommended.',
      },
      {
        title: 'Best Italian Restaurants in Kraków 2026 — Local Eats',
        url: 'https://localeats.pl/krakow/italian',
        snippet:
          'Top picks: 1) Trattoria Milano (Podgórze) — classic Roman cuisine, 2) La Campana (Stare Miasto) — upscale, ' +
          '3) Pasta Fresca (Kazimierz) — casual and cheap.',
      },
    ],
  },
  {
    keywords: ['sushi', 'japanese', 'restaurant', 'kraków', 'best'],
    results: [
      {
        title: 'Sakura Sushi — Kazimierz, Kraków',
        url: 'https://sakura-sushi.krakow.pl',
        snippet:
          'Premium sushi bar on ul. Józefa 8 in Kazimierz. Omakase sets, fresh nigiri, sake selection. ' +
          'Dinner for two: 180–280 zł. Open Tue–Sun from 12:00. Booking essential on weekends.',
      },
      {
        title: 'Sakura Sushi – Google Maps Reviews (4.8★)',
        url: 'https://maps.google.com/sakura-sushi-krakow',
        snippet:
          '4.8 out of 5 stars, 1,240 reviews. "Best sushi in Kraków, period." "Omakase was incredible." ' +
          '"Intimate space, perfect for a date." Reserve 2–3 days ahead for Friday/Saturday.',
      },
      {
        title: 'Top 5 Sushi Spots in Kraków — Foodie Guide 2026',
        url: 'https://krakowfoodie.com/sushi-2026',
        snippet:
          '1) Sakura Sushi (Kazimierz) — top-tier omakase, 2) Edo Sushi (Nowa Huta) — great value, ' +
          '3) Youmiko Vegan Sushi (Stare Miasto) — creative plant-based rolls.',
      },
    ],
  },
  {
    keywords: ['coworking', 'kazimierz', 'meeting room', 'workspace'],
    results: [
      {
        title: 'CoWork Kazimierz — Flexible Workspace & Meeting Rooms',
        url: 'https://cowork-kazimierz.pl',
        snippet:
          'Modern coworking on ul. Meiselsa 6. Hot desks, private offices, and bookable meeting rooms (60 zł/h). ' +
          'Fast Wi-Fi, projector, coffee included. Open Mon–Fri 8–20, Sat 9–16.',
      },
      {
        title: 'CoWork Kazimierz Reviews — Google Maps (4.5★)',
        url: 'https://maps.google.com/cowork-kazimierz',
        snippet:
          '4.5 stars, 310 reviews. "Perfect for client meetings." "Clean, professional, great coffee." ' +
          '"Meeting room has a projector and whiteboard."',
      },
    ],
  },
  {
    keywords: ['café', 'cafe', 'planty', 'coffee', 'botanica'],
    results: [
      {
        title: 'Café Botanica — Specialty Coffee on Planty',
        url: 'https://cafebotanica.pl',
        snippet:
          'Quiet café on al. Słowackiego 1, right by Planty park. Specialty coffee, homemade pastries, ' +
          'work-friendly atmosphere. Big communal table, plenty of outlets. Open Mon–Fri 8–18.',
      },
      {
        title: 'Best Cafés for Remote Work in Kraków — Digital Nomad Guide',
        url: 'https://remotekrakow.com/cafes',
        snippet:
          'Top picks: Café Botanica (Planty) — quiet, great coffee, power outlets. Bunkier Café (Planty) — ' +
          'artsy vibe. Wesoła Café (Wesoła) — spacious, good lunch menu.',
      },
    ],
  },
  {
    keywords: ['restaurant', 'vegetarian', 'lunch', 'kraków'],
    results: [
      {
        title: 'Best Vegetarian-Friendly Restaurants in Kraków',
        url: 'https://krakowfoodie.com/vegetarian-2026',
        snippet:
          'Top options: Trattoria Milano (great veggie risotto + pasta), Glonojad (fully vegan), ' +
          'Café Botanica (good salads and quiche). Most restaurants in Kazimierz have solid veggie options.',
      },
    ],
  },
  {
    keywords: ['kasia', 'nowak', 'techvolt'],
    results: [
      {
        title: 'Kasia Nowak — Engineering Lead at TechVolt | LinkedIn',
        url: 'https://linkedin.com/in/kasia-nowak',
        snippet:
          'Engineering Lead at TechVolt. Based in Kraków. Manages a team of 6 engineers. ' +
          'Previously at Allegro and Brainly. Kraków University of Technology, CS.',
      },
    ],
  },
  {
    keywords: ['tomek', 'brandt', 'shopflow'],
    results: [
      {
        title: 'Tomek Brandt — CTO at ShopFlow | LinkedIn',
        url: 'https://linkedin.com/in/tomek-brandt',
        snippet:
          'CTO at ShopFlow (Berlin). E-commerce platform processing 2M orders/month. ' +
          'Frequent visitor to Kraków for partner meetings.',
      },
    ],
  },
  {
    keywords: ['piotr', 'zieliński', 'fundwise'],
    results: [
      {
        title: 'Piotr Zieliński — Partner at FundWise VC',
        url: 'https://fundwise.vc/team/piotr',
        snippet:
          'Seed-stage investor focused on B2B SaaS in CEE. Portfolio includes TechVolt, DataLens, CloudHQ. ' +
          'Based in Warsaw, takes meetings remotely via Google Meet.',
      },
    ],
  },
];

export const search = (query: string): WebSearchEntry['results'] => {
  const q = query.toLowerCase();
  const scored = searchEntries
    .map((entry) => ({
      entry,
      score: entry.keywords.filter((kw) => q.includes(kw)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.flatMap(({ entry }) => entry.results);
};
