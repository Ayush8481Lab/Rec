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
    let moreFromItemsRaw =[];
    let youMightAlsoLikeItemsRaw =[];

    // 3. Helper function to extract base info
    const extractRaw = (items) => {
      if (!items) return[];
      return items.map(item => ({
        songName: item.titleLinks?.[0]?.title || item.title || 'Unknown Title',
        artistName: item.subtitleLinks?.map(s => s.title).join(', ') || item.subtitle || '',
        albumUrl: item.contentDescriptor?.url || item.url || ''
      })).filter(i => i.albumUrl !== '');
    };

    // 4. Loop through sections to find the required lists
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

    // 5. Ultimate Upgrade: Get exact Apple Music URL AND Spotify URL
    const fetchExactUrls = async (item) => {
      let songLink = item.albumUrl;
      let spotifyUrl = null;

      try {
        // Query iTunes API to get the exact Apple Music Track URL
        const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(item.albumUrl)}&entity=song&country=IN&limit=1`);
        const itunesData = await itunesRes.json();
        
        if (itunesData.results && itunesData.results.length > 0) {
          // Get the clean Apple Music URL
          songLink = itunesData.results[0].trackViewUrl.split('&')[0];
          
          // Extract the track ID (the numbers after ?i=)
          const trackIdMatch = songLink.match(/\?i=(\d+)/);
          
          if (trackIdMatch && trackIdMatch[1]) {
            const trackId = trackIdMatch[1];
            
            // Now, use that ID to hit Song.link to get the Spotify URL!
            const songlinkRes = await fetch(`https://song.link/i/${trackId}`);
            const songlinkHtml = await songlinkRes.text();
            
            // Extract the data from song.link just like we did in step 1!
            const slMatch = songlinkHtml.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
            if (slMatch && slMatch[1]) {
              const slData = JSON.parse(slMatch[1]);
              const slSections = slData.props?.pageProps?.pageData?.sections ||[];
              
              // Loop to find Spotify
              for (const slSection of slSections) {
                if (slSection.links) {
                  const sLink = slSection.links.find(l => l.platform === 'spotify');
                  if (sLink) {
                    spotifyUrl = sLink.url;
                    break;
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        // If anything fails, it will just quietly fallback to null for Spotify
      }
      return { 
        songName: item.songName, 
        artistName: item.artistName, 
        songLink: songLink,
        spotifyUrl: spotifyUrl // Added!
      };
    };

    // 6. Run ALL requests in parallel so your API is incredibly fast
    const moreFromItems = await Promise.all(moreFromItemsRaw.map(fetchExactUrls));
    const youMightAlsoLikeItems = await Promise.all(youMightAlsoLikeItemsRaw.map(fetchExactUrls));

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
