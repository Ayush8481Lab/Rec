export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Please provide an Apple Music URL.' });
  }

  try {
    // 1. Fetch the Apple Music webpage (Added User-Agent so Apple doesn't block us)
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

    // 3. Convert extracted text into a JavaScript object
    const parsedData = JSON.parse(match[1]);
    
    // FIX: Dig one layer deeper into the JSON to find the sections
    const sections = parsedData?.data?.[0]?.data?.sections ||[];

    // 4. Set up empty variables for our results
    let moreFromTitle = "More from Artist";
    let moreFromItems = [];
    let youMightAlsoLikeItems =[];

    // 5. Helper function to extract songs/albums (Made stronger to catch missing links)
    const extractSongs = (items) => {
      if (!items) return[];
      return items.map(item => {
        const songName = item.titleLinks?.[0]?.title || item.title || 'Unknown Title';
        const artistName = item.subtitleLinks?.map(s => s.title).join(', ') || item.subtitle || '';
        const songLink = item.contentDescriptor?.url || item.url || '';
        
        return { songName, artistName, songLink };
      }).filter(i => i.songLink !== ''); 
    };

    // 6. Loop through sections to find the specific categories
    sections.forEach(section => {
      const sectionId = section.id || '';
      // Catch the title whether it is a link or just text
      const headerTitle = section.header?.item?.titleLink?.title || section.header?.item?.title || '';

      // Check for "More by..."
      if (sectionId.includes('more-by-artist') || headerTitle.toLowerCase().includes('more by')) {
        moreFromTitle = headerTitle || "More from this Artist";
        moreFromItems = extractSongs(section.items);
      }

      // Check for "You Might Also Like"
      if (sectionId.includes('you-might-also-like') || headerTitle.toLowerCase().includes('you might also like')) {
        youMightAlsoLikeItems = extractSongs(section.items);
      }
    });

    // 7. Return the neatly formatted JSON response
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
