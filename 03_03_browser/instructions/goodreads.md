# Goodreads Navigation Guide

## CRITICAL RULES
- **NEVER fabricate or guess Goodreads book IDs or URLs.** Always extract real URLs from the page using `evaluate`.
- When you need a book URL, ALWAYS use the "search results recipe" to extract it first.
- If `navigate` returns `status: "error"`, do NOT interact with that page. Go back to search.

## Key URLs
- Search: `https://www.goodreads.com/search?q=QUERY` (URL-encode the query)
- Book page: `https://www.goodreads.com/book/show/BOOK_ID` (get BOOK_ID from search results, never guess)
- Author page: `https://www.goodreads.com/author/show/AUTHOR_ID`
- My books: `https://www.goodreads.com/review/list` (requires login)

## Scenarios and strategies

### 1. Search for a book
Navigate to `https://www.goodreads.com/search?q=ENCODED_QUERY`, then run the "search results recipe" to extract structured data. Done — 2 turns.

### 2. Get cover image URL
Extract the cover from search results (see recipe below). Do NOT click into the book page. 2 turns.

### 3. Get book details (description, rating, genres, page count)
First extract the real URL from search results, then navigate to that URL, then run the "full book details recipe". 3-4 turns.

### 4. Get author bio
From the book page, click the author name link. On the author page, extract bio from `.Text__content1` or the about section.

### 5. Browse user's shelves (my books)
Navigate to `https://www.goodreads.com/review/list?shelf=read` (or `currently-reading`, `to-read`). If redirected to sign-in, tell the user to run `bun run login`.

### 6. Get reviews for a book
Navigate to the book detail page. Run the "reviews recipe" below.

### 7. Get similar books / recommendations
From the book page, look for "Readers also enjoyed" section. Use `evaluate` to extract.

## Strategy: minimize page navigations
Many tasks can be completed from the **search results page alone** — cover thumbnails, titles, authors, ratings, and real URLs are all present. Only navigate to a book detail page when you need description, genres, page count, reviews, or similar books.

## Recipe: search results (covers, links, ratings)
Navigate to `https://www.goodreads.com/search?q=ENCODED_QUERY`, then `evaluate`:

```javascript
(() => {
  const rows = document.querySelectorAll('table.tableList tr[itemtype="http://schema.org/Book"]');
  return [...rows].slice(0, 5).map(row => {
    const titleEl = row.querySelector('a.bookTitle');
    const authorEl = row.querySelector('a.authorName');
    const imgEl = row.querySelector('img.bookCover, img');
    const ratingEl = row.querySelector('.minirating');
    return {
      title: titleEl?.textContent?.trim(),
      url: titleEl ? 'https://www.goodreads.com' + titleEl.getAttribute('href') : null,
      author: authorEl?.textContent?.trim(),
      coverUrl: imgEl?.src?.replace(/\._\w+_\./, '.') ?? imgEl?.src,
      rating: ratingEl?.textContent?.trim(),
    };
  });
})()
```

This gives you cover URLs, **real book page URLs**, authors, and ratings without clicking into any book page. ALWAYS use this to get URLs before navigating to a book page.

## Recipe: full book details (from book detail page)
Only use after extracting the real URL from search results.

```javascript
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

  return { title, author, rating, ratingCount, reviewCount, description, pages, published, genres, coverUrl };
})()
```

## Recipe: reviews (from book detail page)
Goodreads loads reviews dynamically. The reviews section uses these selectors:

```javascript
(() => {
  const reviewCards = document.querySelectorAll('[data-testid="review"], .ReviewCard, article[class*="Review"]');
  if (!reviewCards.length) {
    const fallback = document.querySelectorAll('.ReviewText, [class*="reviewText"], [class*="ReviewBody"]');
    return [...fallback].slice(0, 5).map((el, i) => ({
      index: i + 1,
      text: el.textContent?.trim()?.slice(0, 500),
    }));
  }
  return [...reviewCards].slice(0, 5).map((card, i) => {
    const name = card.querySelector('[data-testid="name"], .ReviewerProfile__name, a[class*="ReviewerProfile"]')?.textContent?.trim();
    const stars = card.querySelectorAll('[class*="RatingStar"][aria-label*="star"], .ReviewCard__star, [data-testid="star"]').length
      || card.querySelector('[aria-label*="Rating"]')?.getAttribute('aria-label');
    const text = card.querySelector('[data-testid="reviewText"], .ReviewText__content, [class*="ReviewText"], .TruncatedContent')?.textContent?.trim()?.slice(0, 500);
    const date = card.querySelector('[data-testid="reviewDate"], .ReviewCard__date, [class*="ReviewDate"]')?.textContent?.trim();
    return { index: i + 1, name, stars, text, date };
  });
})()
```

If the review recipe returns empty, try scrolling down first (`evaluate('window.scrollBy(0, 2000)')`) and then re-run. Reviews may need the page to scroll to load.

## Recipe: book cover only (from detail page)

```javascript
(document.querySelector('[data-testid="bookCover"] img') ?? document.querySelector('.BookCover img'))?.src
```

## Tips
- **NEVER guess book IDs.** Extract real URLs from search results.
- If navigate returns an error page, go back to search and use `evaluate` to get the correct URL.
- Book descriptions may be truncated — click "Show more" (`click({ selector: '[data-testid="description"] button, button.Button--inline' })`) before extracting.
- Cover URLs from search results are thumbnails. Remove the dimension suffix (e.g., `._SX50_`) for full-size images.
- Prefer `evaluate` with the recipes above over `get_content`.
- For "my books" / "my shelves" queries, the user must be logged in.
