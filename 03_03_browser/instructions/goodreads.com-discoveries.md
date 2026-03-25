# goodreads.com — discoveries (working extraction)

## Full book details (works on modern Goodreads book page)

Use after navigating to a **real** book URL (never guess IDs/URLs).

```js
(() => {
  const title = document.querySelector('[data-testid="bookTitle"]')?.textContent?.trim()
    ?? document.querySelector('h1')?.textContent?.trim();

  const author = document.querySelector('.ContributorLink__name')?.textContent?.trim()
    ?? document.querySelector('[data-testid="name"]')?.textContent?.trim();

  const rating = document.querySelector('[data-testid="averageRating"]')?.textContent?.trim();
  const ratingCount = document.querySelector('[data-testid="ratingsCount"]')?.textContent?.trim();
  const reviewCount = document.querySelector('[data-testid="reviewsCount"]')?.textContent?.trim();

  const description = document.querySelector('[data-testid="description"]')?.textContent?.trim();
  const pages = document.querySelector('[data-testid="pagesFormat"]')?.textContent?.trim();
  const published = document.querySelector('[data-testid="publicationInfo"]')?.textContent?.trim();

  const genres = [...document.querySelectorAll('[data-testid="genresList"] .BookPageMetadataSection__genreButton a')]
    .map(el => el.textContent?.trim()).filter(Boolean);

  const coverUrl = (document.querySelector('[data-testid="bookCover"] img')
    ?? document.querySelector('.BookCover img'))?.src;

  return { title, author, rating, ratingCount, reviewCount, description, pages, published, genres, coverUrl, url: location.href.split('?')[0] };
})()
```

## Notes
- `pagesFormat` sometimes returns just the format (e.g. "Paperback"); keep as-is.
- `rating` may be null if not visible in some layouts; `ratingCount` and `reviewCount` usually exist.
