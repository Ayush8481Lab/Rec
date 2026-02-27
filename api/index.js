export default async function handler(req, res) {
  // Get the Apple Music URL from the query string
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Please provide an Apple Music URL. Example: /api?url=https://music.apple.com/...' });
  }

  try {
    // 1. Fetch the Apple Music webpage
    const response = await fetch(url);
    const html = await response.text();

    // 2. Extract the hidden JSON block using Regex
    const match = html.match(/<script type="application\/json" id="serialized-server-data">([\s\S]*?)<\/script>/);
    
    if (!match || !match[1]) {
      return res.status(404).json({ error: 'Could not find Apple Music data on this page.' });
    }

    // 3. Convert extracted text into a JavaScript object
    const data = JSON.parse(match[1]);
    const sections = data[0]?.data?.sections ||[];

    // 4. Set up the empty variables for our results
    let moreFromTitle = "More from Artist";
    let moreFromItems = [];
    let youMightAlsoLikeItems =[];

    // 5. Helper function to extract songs/albums from a section
    const extractSongs = (items) => {
      if (!items) return[];
      return items.map(item => ({
        songName: item.titleLinks?.[0]?.title || 'Unknown Title',
        artistName: item.subtitleLinks?.map(s => s.title).join(', ') || 'Unknown Artist/Year',
        songLink: item.contentDescriptor?.url || ''
      })).filter(i => i.songLink !== ''); // Only keep items that have a link
    };

    // 6. Loop through sections to find "More By..." and "You Might Also Like"
    sections.forEach(section => {
      const sectionId = section.id || '';
      const headerTitle = section.header?.item?.titleLink?.title || '';

      // Check for "More by [Artist]"
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
