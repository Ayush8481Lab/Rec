export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Please provide an Apple Music URL.' });
  }

  try {
    // 1. Fetch Apple Music webpage
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
      }
    });
    const html = await response.text();

    // 2. Extract hidden JSON
    const match = html.match(/<script type="application\/json" id="serialized-server-data">([\s\S]*?)<\/script>/);
    if (!match || !match[1]) {
      return res.status(404).json({ error: 'Could not find Apple Music data on this page.' });
    }

    const parsedData = JSON.parse(match[1]);
    const sections = parsedData?.data?.[0]?.data?.sections ||[];

    let moreFromTitle = "More from Artist";
    let youMayLikeTitle = "You Might Also Like";
    
    let moreFromIds = [];
    let youMayLikeIds =[];
    let rawItemsMap = {};

    // 3. Helper: Extract exact Apple IDs (We slice to Top 5 items to guarantee 1-2 second speeds)
    const extractIds = (items, idArray) => {
      if (!items) return;
      items.slice(0, 5).forEach(item => {
        const id = item.contentDescriptor?.identifiers?.storeAdamID;
        if (id) {
          idArray.push(id);
          rawItemsMap[id] = {
            songName: item.titleLinks?.[0]?.title || item.title || 'Unknown Title',
            artistName: item.subtitleLinks?.map(s => s.title).join(', ') || item.subtitle || ''
          };
        }
      });
    };

    // 4. Find the sections
    sections.forEach(section => {
      const sectionId = section.id || '';
      const headerTitle = section.header?.item?.titleLink?.title || section.header?.item?.title || '';

      if (sectionId.includes('more-by-artist') || headerTitle.toLowerCase().includes('more by')) {
        moreFromTitle = headerTitle || "More from this Artist";
        extractIds(section.items, moreFromIds);
      }
      if (sectionId.includes('you-might-also-like') || headerTitle.toLowerCase().includes('you might also like')) {
        youMayLikeTitle = headerTitle || "You Might Also Like";
        extractIds(section.items, youMayLikeIds);
      }
    });

    const allIds = [...moreFromIds, ...youMayLikeIds];
    if (allIds.length === 0) {
       return res.status(200).json({ success: true, moreFrom: { title: moreFromTitle, items: [] }, youMayLike: { title: youMayLikeTitle, items:[] } });
    }

    // 5. BIG SPEED UP: 1 Single iTunes Request for ALL IDs! (Takes 0.2s instead of 5s)
    const itunesRes = await fetch(`https://itunes.apple.com/lookup?id=${allIds.join(',')}&entity=song&country=IN`);
    const itunesData = await itunesRes.json();

    const trackMap = {};
    if (itunesData.results) {
      itunesData.results.forEach(result => {
        // Map the album ID to the very first track in that album
        if (result.wrapperType === 'track' && !trackMap[result.collectionId]) {
          trackMap[result.collectionId] = result;
        }
      });
    }

    // 6. BIG SPEED UP: Use Odesli Official API (Returns Tiny JSON in 0.1s instead of downloading giant HTML pages)
    const getFinalData = async (albumId) => {
      const track = trackMap[albumId];
      const rawInfo = rawItemsMap[albumId];
      let songLink = "";
      let spotifyUrl = null;

      if (track) {
        songLink = track.trackViewUrl.split('&')[0];
        try {
          // Fetch from Song.link API directly using the Apple Music Track ID
          const odesliRes = await fetch(`https://api.odesli.co/MUSE/v1/links?id=${track.trackId}&platform=appleMusic&type=song`);
          if (odesliRes.ok) {
            const odesliData = await odesliRes.json();
            spotifyUrl = odesliData.linksByPlatform?.spotify?.url || null;
          }
        } catch (e) {
          // Fallback silently if API fails
        }
      }

      return {
        songName: rawInfo.songName,
        artistName: rawInfo.artistName,
        songLink: songLink,
        spotifyUrl: spotifyUrl
      };
    };

    // Run the fast API calls in parallel
    const moreFromItems = await Promise.all(moreFromIds.map(getFinalData));
    const youMightAlsoLikeItems = await Promise.all(youMayLikeIds.map(getFinalData));

    // 7. Return the final output
    return res.status(200).json({ 
      success: true,
      moreFrom: {
        title: moreFromTitle,
        items: moreFromItems
      },
      youMayLike: {
        title: youMayLikeTitle,
        items: youMightAlsoLikeItems
      }
    });

  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch data.', details: error.message });
  }
        }
