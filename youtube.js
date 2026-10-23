(() => {
  const tools = document.querySelector('#tools');
  if (!tools) return;

  const style = document.createElement('style');
  style.textContent = '.yt-tool{max-height:44vh;overflow:auto}.yt-tool input{width:155px;padding:6px;font-size:11px}.yt-results{max-height:115px;overflow:auto}.yt-result{display:flex;align-items:center;gap:7px;width:100%;margin-top:5px;text-align:left;background:#293e39;padding:6px;font-size:10px}.yt-result img{width:48px;height:36px;object-fit:cover;border-radius:4px}.yt-frame{width:250px;height:200px;background:#10251f;padding:5px;border-radius:9px;margin-top:6px}.yt-frame iframe{width:100%;height:100%;border:0;border-radius:5px}.yt-message{font-size:10px;color:#d8e5cf;line-height:1.35;margin-top:5px}.yt-message a{color:#f2d777}';
  document.head.append(style);

  const panel = document.createElement('div');
  panel.className = 'tool yt-tool';
  panel.innerHTML = '<label for="ytQuery">🎶 Procurar no YouTube</label><div style="display:flex;gap:4px"><input id="ytQuery" maxlength="100" placeholder="Nome da música ou link"><button id="ytSearch">Buscar</button></div><div id="ytResults" class="yt-results"></div><div id="ytMessage" class="yt-message"></div><div id="ytHolder" class="yt-frame hidden"></div>';
  tools.append(panel);

  const $ = selector => document.querySelector(selector);
  function youtubeId(value) {
    const v = String(value).trim();
    if (/^[\w-]{11}$/.test(v)) return v;
    try {
      const url = new URL(v);
      if (url.hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0];
      if (url.hostname.endsWith('youtube.com') || url.hostname.endsWith('youtube-nocookie.com')) {
        if (url.searchParams.get('v')) return url.searchParams.get('v');
        return url.pathname.match(/\/(?:embed|shorts)\/([\w-]{11})/)?.[1] || null;
      }
    } catch {}
    return null;
  }

  function playYoutube(id, title) {
    if (!/^[\w-]{11}$/.test(id)) return;
    const holder = $('#ytHolder');
    holder.replaceChildren();
    const frame = document.createElement('iframe');
    frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?playsinline=1&rel=0`;
    frame.title = title || 'YouTube video';
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allowFullscreen = true;
    holder.append(frame);
    holder.classList.remove('hidden');
    $('#ytMessage').textContent = 'Player oficial do YouTube. A reprodução é só para você.';
  }

  $('#ytSearch').addEventListener('click', async () => {
    const query = $('#ytQuery').value.trim();
    if (!query) return;
    $('#ytMessage').textContent = 'Buscando…';
    $('#ytResults').replaceChildren();
    const id = youtubeId(query);
    if (id) return playYoutube(id, 'YouTube video');

    try {
      const response = await fetch('/api/youtube-search?q=' + encodeURIComponent(query));
      const data = await response.json();
      if (!response.ok) {
        if (data.error === 'missing_key') {
          const link = document.createElement('a');
          link.href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'Abrir busca do YouTube';
          $('#ytMessage').textContent = 'Para mostrar resultados aqui, falta configurar YOUTUBE_API_KEY no Render. Por enquanto, busque no YouTube e cole o link do vídeo neste campo. ';
          $('#ytMessage').append(link);
          return;
        }
        throw new Error(data.error || 'Falha na busca.');
      }
      $('#ytMessage').textContent = data.length ? 'Escolha um vídeo para tocar.' : 'Não encontrei vídeos.';
      data.forEach(item => {
        const button = document.createElement('button');
        button.className = 'yt-result';
        const image = document.createElement('img');
        image.src = item.thumbnail;
        image.alt = '';
        const text = document.createElement('span');
        text.textContent = item.title + ' — ' + item.channel;
        button.append(image, text);
        button.addEventListener('click', () => playYoutube(item.id, item.title));
        $('#ytResults').append(button);
      });
    } catch (error) {
      $('#ytMessage').textContent = error.message || 'Falha na busca do YouTube.';
    }
  });

  $('#ytQuery').addEventListener('keydown', event => {
    if (event.key === 'Enter') $('#ytSearch').click();
  });
})();
