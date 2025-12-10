/**
 * Netlify function to fetch and extract the "wrap" div content from Lone Star Circuit
 */
export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };

  // Handle preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers,
      body: "",
    };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const response = await fetch("https://www.lonestarcircuit.com/currentStandings.html");

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();

    // Extract the three standings sections by their h3 tags
    const standingsSections = [];
    const targetHeadings = ['Individual Standings', 'Team Standings', 'Club Standings'];

    for (const heading of targetHeadings) {
      // Find the h3 tag with this heading
      const h3Pattern = new RegExp(`<h3[^>]*>\\s*${heading}\\s*<\\/h3>`, 'i');
      const h3Match = html.match(h3Pattern);

      if (!h3Match) continue;

      const h3Index = html.indexOf(h3Match[0]);
      const h3EndIndex = h3Index + h3Match[0].length;

      // Find the next h3 or h2 tag to know where this section ends
      const nextHeadingPattern = /<h[23][^>]*>/gi;
      const remainingHtml = html.substring(h3EndIndex);
      const nextHeadingMatch = remainingHtml.match(nextHeadingPattern);

      let sectionEndIndex;
      if (nextHeadingMatch) {
        const nextHeadingIndex = remainingHtml.indexOf(nextHeadingMatch[0]);
        sectionEndIndex = h3EndIndex + nextHeadingIndex;
      } else {
        // If no next heading, look for the last updated text or footer
        const lastUpdatedMatch = remainingHtml.match(/Last Updated:|© Copyright/i);
        if (lastUpdatedMatch) {
          sectionEndIndex = h3EndIndex + remainingHtml.indexOf(lastUpdatedMatch[0]);
        } else {
          sectionEndIndex = html.length;
        }
      }

      // Extract the section content
      const sectionContent = html.substring(h3Index, sectionEndIndex);
      standingsSections.push(sectionContent);
    }

    if (standingsSections.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Could not find standings sections in HTML" }),
      };
    }

    const wrapContent = standingsSections.join('\n\n');

    return {
      statusCode: 200,
      headers: {
        ...headers,
        "Content-Type": "text/html",
        "Cache-Control": "public, max-age=2592000, s-maxage=2592000", // 30 days
      },
      body: wrapContent,
    };
  } catch (error) {
    console.error("Error fetching standings:", error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Failed to fetch standings",
        message: error.message
      }),
    };
  }
};
