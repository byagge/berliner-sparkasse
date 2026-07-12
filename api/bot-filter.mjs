/**
 * Filter search engines / crawlers / monitoring bots from Telegram logs.
 */

const BOT_UA =
  /(?:bot|crawl|spider|slurp|fetch|scrape|scan|monitor|check|preview|headless|phantom|selenium|puppeteer|playwright|wget|curl|httpclient|python-requests|python-urllib|go-http|java\/|okhttp|libwww|scrapy|axios\/|node-fetch|undici|facebookexternalhit|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|whatsapp|applebot|bingbot|googlebot|yandex|baidu|duckduck|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|anthropic|chatgpt|perplexity|ccbot|archive\.org|ia_archiver|wayback|uptimerobot|pingdom|statuscake|site24x7|newrelic|datadog|nagios|zabbix|prism|lighthouse|pagespeed|gtmetrix|pingdom|screaming\s*frog|seokicks|blexbot|megaindex|serpstat|majestic|rogerbot|embedly|quora\s*link|pinterest|flipboard|tumblr|skypeuripreview|vkshare|odnoklassniki|yandexbot|mail\.ru|yahoo!\s*slurp|msnbot|adidxbot|bingpreview|storebot|adsbot|mediapartners|feedfetcher|google-inspection|googleother|storebot-google|amazonbot|claude-web|cohere-ai|meta-externalagent|imagesift|dataforseo|serp|indexer|checker|validator|probe|healthcheck|uptime|synthetic|dataprovider)/i;

const EMPTY_OR_SHORT = /^[\s\-_.]*$|^mozilla\/?$|^mozilla\/4\.0$/i;

/**
 * @param {string} [ua]
 * @returns {boolean}
 */
export function isBotUserAgent(ua) {
  const s = String(ua || '').trim();
  if (!s || s.length < 12) return true;
  if (EMPTY_OR_SHORT.test(s)) return true;
  if (BOT_UA.test(s)) return true;
  // Real browsers almost always include Mozilla + (Chrome|Firefox|Safari|Edg)
  const looksLikeBrowser =
    /mozilla\/\d/i.test(s) &&
    (/(?:chrome|crios|firefox|fxios|safari|edg|opr|opera|samsungbrowser|ucbrowser)\//i.test(s) ||
      /iphone|ipad|android/i.test(s));
  if (!looksLikeBrowser) return true;
  return false;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
export function isBotRequest(req) {
  const ua = req.headers['user-agent'] || '';
  if (isBotUserAgent(ua)) return true;

  // Crawlers often omit Accept-Language on HTML navigation
  const accept = String(req.headers.accept || '');
  const al = req.headers['accept-language'];
  if (accept.includes('text/html') && (!al || !String(al).trim())) return true;

  return false;
}
