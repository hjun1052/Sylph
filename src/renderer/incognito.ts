// Incognito page script
let currentEngine = 'search';
const engines = {
  search: {
    url: 'https://www.google.com/search?udm=50&source=searchlabs&q=',
    color: 'linear-gradient(90deg, #6a0dad, #7b61ff, #ff00cc, #00ffff)',
    label: 'Search',
  },
  google: {
    url: 'https://www.google.com/search?q=',
    color: 'linear-gradient(90deg, #6a0dad, #7b61ff, #ff00cc, #00ffff)',
    label: 'Google',
  },
  bing: {
    url: 'https://www.bing.com/search?q=',
    color: 'linear-gradient(90deg, #0078d4, #00aaff, #4facfe, #00f2fe)',
    label: 'Bing',
  },
  duckduckgo: {
    url: 'https://duckduckgo.com/?q=',
    color: 'linear-gradient(90deg, #ff8800, #ffaa33, #ffcc66, #ffbb00)',
    label: 'DuckDuckGo',
  },
  chatgpt: {
    url: 'https://chatgpt.com/?q=',
    color: 'linear-gradient(90deg, #10a37f, #14b8a6, #2dd4bf, #5eead4)',
    label: 'ChatGPT',
  },
  youtube: {
    url: 'https://www.youtube.com/results?search_query=',
    color: 'linear-gradient(90deg, #ff0000, #ff4d4d, #ff6666, #ff8080)',
    label: 'YouTube',
  },
  github: {
    url: 'https://github.com/search?q=',
    color: 'linear-gradient(90deg, #333, #555, #777, #999)',
    label: 'GitHub',
  },
  reddit: {
    url: 'https://www.reddit.com/search/?q=',
    color: 'linear-gradient(90deg, #ff4500, #ff6b00, #ff8c00, #ffa500)',
    label: 'Reddit',
  },
  stackoverflow: {
    url: 'https://stackoverflow.com/search?q=',
    color: 'linear-gradient(90deg, #f48024, #f8a23b, #fbbf24, #ffcd38)',
    label: 'Stack Overflow',
  },
  wikipedia: {
    url: 'https://en.wikipedia.org/wiki/',
    color: 'linear-gradient(90deg, #808080, #a0a0a0, #c0c0c0, #dcdcdc)',
    label: 'Wikipedia',
  },
  translate: {
    url: 'https://translate.google.com/?sl=auto&tl=en&text=',
    color: 'linear-gradient(90deg, #4285F4, #34A853, #FBBC05, #EA4335)',
    label: 'Translate',
  },
  naver: {
    url: 'https://search.naver.com/search.naver?query=',
    color: 'linear-gradient(90deg, #03C75A, #00B14F, #00A14D, #00934A)',
    label: 'Naver',
  },
  perplexity: {
    url: 'https://www.perplexity.ai/search?q=',
    color: 'linear-gradient(90deg, #7B61FF, #9C8CFF, #BBAAFF, #DCC8FF)',
    label: 'Perplexity',
  },
  ooai: {
    url: 'https://oo.ai/search?q=',
    color: 'linear-gradient(90deg, #FF6EC4, #FF88D1, #FFA3DD, #FFBEEC)',
    label: 'oo.ai',
  },
};

const input = document.getElementById('searchInput') as HTMLInputElement;
const button = document.getElementById('searchButton') as HTMLButtonElement;
const form = document.getElementById('searchForm') as HTMLFormElement;
const container = document.querySelector('.search-container') as HTMLElement;

input.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    const value = input.value.trim().toLowerCase();
    if (engines[value as keyof typeof engines]) {
      currentEngine = value;
      container.classList.add('bounce');
      const style = document.styleSheets[0];
      // Remove old rule if exists
      for (let i = style.cssRules.length - 1; i >= 0; i--) {
        const rule = style.cssRules[i];
        if (rule instanceof CSSStyleRule && rule.selectorText === '.search-container::before') {
          style.deleteRule(i);
        }
      }
      style.insertRule(
        `.search-container::before { background: ${engines[value as keyof typeof engines].color} }`,
        style.cssRules.length,
      );
      button.textContent = engines[value as keyof typeof engines].label;
      input.value = '';
      setTimeout(() => container.classList.remove('bounce'), 400);
    }
  }
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const query = input.value.trim();
  if (query) {
    window.location.href = engines[currentEngine as keyof typeof engines].url + encodeURIComponent(query);
  }
});
