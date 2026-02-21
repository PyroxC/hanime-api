const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

const app = express();

const jsongen = async (url) => {
  try {
    const headers = {
      'X-Signature-Version': 'web2',
      'X-Signature': crypto.randomBytes(32).toString('hex'),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://hanime.tv/',
      'Origin': 'https://hanime.tv',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    const res = await axios.get(url, { headers });
    return res.data;
  } catch (error) {
    throw new Error(`Error fetching data: ${error.message}`);
  }
};

const getStreamUrl = async (slug) => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
  });

  try {
    const page = await browser.newPage();
    let streamUrl = null;

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('.m3u8') && !streamUrl) {
        streamUrl = url;
      }
    });

    await page.goto(`https://hanime.tv/videos/hentai/${slug}`, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    await new Promise((r) => setTimeout(r, 5000));

    await browser.close();
    return streamUrl;
  } catch (error) {
    await browser.close();
    throw new Error(`Puppeteer error: ${error.message}`);
  }
};

const getTrending = async (time, page) => {
  const url = `https://hanime.tv/api/v8/browse-trending?time=${time}&page=${page}&order_by=views&ordering=desc`;
  const urldata = await jsongen(url);
  return urldata.hentai_videos.map((x) => ({
    id: x.id,
    name: x.name,
    slug: x.slug,
    cover_url: x.cover_url,
    views: x.views,
    link: `/watch/${x.slug}`,
  }));
};

const getVideo = async (slug) => {
  const videoData = await jsongen(`https://hanime.tv/api/v8/video?id=${slug}`);
  const tags = videoData.hentai_tags.map((t) => ({
    name: t.text,
    link: `/hentai-tags/${t.text}/0`,
  }));
  const episodes = videoData.hentai_franchise_hentai_videos.map((e) => ({
    id: e.id,
    name: e.name,
    slug: e.slug,
    cover_url: e.cover_url,
    views: e.views,
    link: `/watch/${e.slug}`,
  }));
  return {
    id: videoData.hentai_video.id,
    name: videoData.hentai_video.name,
    description: videoData.hentai_video.description,
    poster_url: videoData.hentai_video.poster_url,
    cover_url: videoData.hentai_video.cover_url,
    views: videoData.hentai_video.views,
    tags,
    episodes,
  };
};

const getBrowse = async () => {
  return await jsongen('https://hanime.tv/api/v8/browse');
};

const getBrowseVideos = async (type, category, page) => {
  const url = `https://hanime.tv/api/v8/browse/${type}/${category}?page=${page}&order_by=views&ordering=desc`;
  const browsedata = await jsongen(url);
  return browsedata.hentai_videos.map((x) => ({
    id: x.id,
    name: x.name,
    slug: x.slug,
    cover_url: x.cover_url,
    views: x.views,
    link: `/watch/${x.slug}`,
  }));
};

const searchVideos = async (query, page = 0) => {
  const url = `https://hanime.tv/api/v8/search?search_text=${encodeURIComponent(query)}&page=${page}&order_by=views&ordering=desc`;
  const data = await jsongen(url);
  return data.hentai_videos.map((x) => ({
    id: x.id,
    name: x.name,
    slug: x.slug,
    cover_url: x.cover_url,
    views: x.views,
    link: `/watch/${x.slug}`,
  }));
};

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Hanime API 👀',
    endpoints: [
      'GET /trending/:time/:page  — time: day | week | month',
      'GET /watch/:slug',
      'GET /stream/:slug  — real m3u8 stream URL',
      'GET /browse/:type  — type: hentai_tags | brands',
      'GET /tags',
      'GET /search/:query/:page',
      'GET /:type/:category/:page',
    ],
  });
});

// Video info (no stream)
app.get('/watch/:slug', async (req, res, next) => {
  try {
    const data = await getVideo(req.params.slug);
    res.json({ results: [data] });
  } catch (error) {
    next(error);
  }
});

// Real stream URL via Puppeteer
app.get('/stream/:slug', async (req, res, next) => {
  try {
    const streamUrl = await getStreamUrl(req.params.slug);
    if (!streamUrl) {
      return res.status(404).json({ error: 'Stream URL not found' });
    }
    res.json({ stream_url: streamUrl });
  } catch (error) {
    next(error);
  }
});

app.get('/trending/:time/:page', async (req, res, next) => {
  try {
    const { time, page } = req.params;
    const jsondata = await getTrending(time, page);
    res.json({
      results: jsondata,
      next_page: `/trending/${time}/${parseInt(page) + 1}`,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/browse/:type', async (req, res, next) => {
  try {
    const { type } = req.params;
    const data = await getBrowse();
    let jsondata = data[type];
    if (!jsondata) {
      return res.status(404).json({ error: `Type "${type}" not found` });
    }
    if (type === 'hentai_tags') {
      jsondata = jsondata.map((x) => ({ ...x, url: `/hentai-tags/${x.text}/0` }));
    } else if (type === 'brands') {
      jsondata = jsondata.map((x) => ({ ...x, url: `/brands/${x.slug}/0` }));
    }
    res.json({ results: jsondata });
  } catch (error) {
    next(error);
  }
});

app.get('/tags', async (req, res, next) => {
  try {
    const data = await getBrowse();
    const jsondata = data.hentai_tags.map((x) => ({
      ...x,
      url: `/tags/${x.text}/0`,
    }));
    res.json({ results: jsondata });
  } catch (error) {
    next(error);
  }
});

app.get('/search/:query/:page', async (req, res, next) => {
  try {
    const { query, page } = req.params;
    const data = await searchVideos(query, page);
    res.json({
      results: data,
      next_page: `/search/${query}/${parseInt(page) + 1}`,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/:type/:category/:page', async (req, res, next) => {
  try {
    const { type, category, page } = req.params;
    const data = await getBrowseVideos(type, category, page);
    res.json({
      results: data,
      next_page: `/${type}/${category}/${parseInt(page) + 1}`,
    });
  } catch (error) {
    next(error);
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Something went wrong' });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;
