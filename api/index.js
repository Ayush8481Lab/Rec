export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Please provide an Apple Music URL.' });
  }

  try {
    // 1. Fetch the Apple Music webpage
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
      }
    });
    const html = await response.text();

    // 2. Extract the hidden JSON block
    const match = html.match(/<script type="application\/json" id="serialized-server-data">([\s\S]*?)<\/script>/);
    
    if (!match || !match[1]) {
      return res.status(404).json({ error: 'Could not find Apple Music data on this page.' });
    }

    const parsedData = JSON.parse(match[1]);
    const sections = parsedData?.data?.[0]?.data?.sections ||[];

    let moreFromTitle = "More from Artist";
    let moreFromItemsRaw = [];
    let youMightAlsoLikeItemsRaw =[];

    // 3. Helper function to extract base info and the Album URL
    const extractRaw = (items) => {
      if (!items) return[];
      return items.map(item => ({
        songName: item.titleLinks?.[0]?.title || item.title || 'Unknown Title',
        artistName: item.subtitleLinks?.map(s => s.title).join(', ') || item.subtitle || '',
        albumUrl: item.contentDescriptor?.url || item.url || ''
      })).filter(i => i.albumUrl !== '');
    };

    // 4. Loop through sections
    sections.forEach(section => {
      const sectionId = section.id || '';
      const headerTitle = section.header?.item?.titleLink?.title || section.header?.item?.title || '';

      if (sectionId.includes('more-by-artist') || headerTitle.toLowerCase().includes('more by')) {
        moreFromTitle = headerTitle || "More from this Artist";
        moreFromItemsRaw = extractRaw(section.items);
      }

      if (sectionId.includes('you-might-also-like') || headerTitle.toLowerCase().includes('you might also like')) {
        youMightAlsoLikeItemsRaw = extractRaw(section.items);
      }
    });

    // 5. Upgrade function: Call iTunes API to get the exact Song URL (with ?i=...)
    const fetchExactSongUrl = async (item) => {
      try {
        // Query the iTunes API with the Album URL (limit=1 for speed)
        const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(item.albumUrl)}&entity=song&country=IN&limit=1`);
        const itunesData = await itunesRes.json();
        
        if (itunesData.results && itunesData.results.length > 0) {
          // Get the trackViewUrl and split at '&' to remove tracking tags like '&uo=4'
          const exactUrl = itunesData.results[0].trackViewUrl.split('&')[0];
          return { songName: item.songName, artistName: item.artistName, songLink: exactUrl };
        }
      } catch (e) {
        // If iTunes API fails for some reason, fallback to original album URL
      }
      return { songName: item.songName, artistName: item.artistName, songLink: item.albumUrl };
    };

    // 6. Run all iTunes API requests at the same time (Promise.all) so it doesn't slow down your API
    const moreFromItems = await Promise.all(moreFromItemsRaw.map(fetchExactSongUrl));
    const youMightAlsoLikeItems = await Promise.all(youMightAlsoLikeItemsRaw.map(fetchExactSongUrl));

    // 7. Return the final output
    return res.status(200).json({ 
      success: true,
      moreFrom: {
        title: moreFromTitle,
        items: moreFromItems
      },
      youMayLike: {
        title: "You Might Also Like",
        items: youMightAlsoLikeItems
      }
    });

  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch data.', details: error.message });
  }
}
