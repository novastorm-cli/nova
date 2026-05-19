// Project map HTML page — embedded so it survives tsup bundling.
// import.meta.dirname resolves to the bundler output directory when bundled
// into the CLI, so we can't use file-system reads for static assets.

export const PROJECT_MAP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nova -- Project Map</title>
  <script src="https://unpkg.com/cytoscape@3.28.1/dist/cytoscape.min.js"></script>
  <script src="https://unpkg.com/dagre@0.8.5/dist/dagre.min.js"></script>
  <script src="https://unpkg.com/cytoscape-dagre@2.5.0/cytoscape-dagre.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      display: flex;
      height: 100vh;
      overflow: hidden;
    }
    .sidebar {
      width: 280px;
      background: #161b22;
      border-right: 1px solid #30363d;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .sidebar-header {
      padding: 16px;
      border-bottom: 1px solid #30363d;
    }
    .sidebar-header h1 {
      font-size: 16px;
      font-weight: 600;
      color: #f0f6fc;
    }
    .sidebar-header .stats {
      font-size: 12px;
      color: #8b949e;
      margin-top: 4px;
    }
    .search-box {
      padding: 12px 16px;
      border-bottom: 1px solid #30363d;
    }
    .search-box input {
      width: 100%;
      padding: 8px 12px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #c9d1d9;
      font-size: 13px;
      outline: none;
    }
    .search-box input:focus {
      border-color: #58a6ff;
    }
    .file-tree {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }
    .file-tree::-webkit-scrollbar { width: 6px; }
    .file-tree::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
    .tree-item {
      padding: 6px 16px;
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: background 0.1s;
    }
    .tree-item:hover { background: #1c2128; }
    .tree-item.active { background: #1f6feb22; color: #58a6ff; }
    .tree-item .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    #cy {
      flex: 1;
      background: #0d1117;
    }
    .detail-panel {
      width: 320px;
      background: #161b22;
      border-left: 1px solid #30363d;
      display: none;
      flex-direction: column;
      overflow: hidden;
    }
    .detail-panel.open { display: flex; }
    .detail-header {
      padding: 16px;
      border-bottom: 1px solid #30363d;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .detail-header h2 {
      font-size: 14px;
      font-weight: 600;
      color: #f0f6fc;
      word-break: break-all;
    }
    .detail-close {
      background: none;
      border: none;
      color: #8b949e;
      cursor: pointer;
      font-size: 18px;
      padding: 4px;
    }
    .detail-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }
    .detail-section { margin-bottom: 16px; }
    .detail-section h3 {
      font-size: 12px;
      text-transform: uppercase;
      color: #8b949e;
      margin-bottom: 8px;
      letter-spacing: 0.5px;
    }
    .detail-section .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      margin: 2px;
    }
    .method-item {
      padding: 8px;
      background: #0d1117;
      border-radius: 6px;
      margin-bottom: 6px;
      font-size: 12px;
    }
    .method-item .name { color: #d2a8ff; font-weight: 600; }
    .method-item .sig { color: #8b949e; font-size: 11px; margin-top: 2px; }
    .method-item .purpose { color: #7ee787; font-size: 11px; margin-top: 2px; }
    .type-component { background: #1f6feb33; color: #58a6ff; }
    .type-page { background: #d2a8ff33; color: #d2a8ff; }
    .type-api { background: #7ee78733; color: #7ee787; }
    .type-model { background: #f778ba33; color: #f778ba; }
    .type-hook { background: #ffa65733; color: #ffa657; }
    .type-util { background: #8b949e33; color: #8b949e; }
    .type-config { background: #f0f6fc33; color: #f0f6fc; }
    .legend {
      padding: 12px 16px;
      border-top: 1px solid #30363d;
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      font-size: 11px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #8b949e;
    }
  </style>
</head>
<body>
  <div class="sidebar">
    <div class="sidebar-header">
      <h1>Nova Project Map</h1>
      <div class="stats" id="stats">Loading...</div>
    </div>
    <div class="search-box">
      <input type="text" id="searchInput" placeholder="Search files, methods..." />
    </div>
    <div class="file-tree" id="fileTree"></div>
    <div class="legend">
      <div class="legend-item"><div class="legend-dot" style="background:#58a6ff"></div> Component</div>
      <div class="legend-item"><div class="legend-dot" style="background:#d2a8ff"></div> Page</div>
      <div class="legend-item"><div class="legend-dot" style="background:#7ee787"></div> API</div>
      <div class="legend-item"><div class="legend-dot" style="background:#f778ba"></div> Model</div>
      <div class="legend-item"><div class="legend-dot" style="background:#ffa657"></div> Hook</div>
      <div class="legend-item"><div class="legend-dot" style="background:#8b949e"></div> Util</div>
    </div>
  </div>
  <div class="main">
    <div id="cy"><div class="loading">Loading project graph...</div></div>
  </div>
  <div class="detail-panel" id="detailPanel">
    <div class="detail-header">
      <h2 id="detailTitle"></h2>
      <button class="detail-close" id="detailClose">&times;</button>
    </div>
    <div class="detail-content" id="detailContent"></div>
  </div>

  <script>
    const TYPE_COLORS = {
      component: '#58a6ff',
      page: '#d2a8ff',
      api: '#7ee787',
      model: '#f778ba',
      hook: '#ffa657',
      util: '#8b949e',
      config: '#f0f6fc',
    };

    let cy;
    let graphData = null;

    async function fetchData() {
      const res = await fetch('/nova-api/project-map');
      return res.json();
    }

    function initGraph(data) {
      graphData = data;
      const loadingEl = document.querySelector('.loading');
      if (loadingEl) loadingEl.remove();

      const elements = [];

      for (const node of data.nodes) {
        elements.push({
          data: {
            id: node.id,
            label: node.label,
            type: node.type,
            exports: node.exports,
            keywords: node.keywords,
            route: node.route,
            methods: node.methods || [],
          },
        });
      }

      for (const edge of data.edges) {
        elements.push({
          data: {
            id: edge.source + '->' + edge.target,
            source: edge.source,
            target: edge.target,
          },
        });
      }

      cy = cytoscape({
        container: document.getElementById('cy'),
        elements: elements,
        style: [
          {
            selector: 'node',
            style: {
              'label': 'data(label)',
              'background-color': function(ele) { return TYPE_COLORS[ele.data('type')] || '#8b949e'; },
              'color': '#c9d1d9',
              'font-size': '10px',
              'text-valign': 'bottom',
              'text-margin-y': 6,
              'width': 30,
              'height': 30,
              'border-width': 2,
              'border-color': function(ele) { return TYPE_COLORS[ele.data('type')] || '#8b949e'; },
              'background-opacity': 0.3,
            },
          },
          {
            selector: 'edge',
            style: {
              'width': 1,
              'line-color': '#30363d',
              'target-arrow-color': '#30363d',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              'arrow-scale': 0.8,
            },
          },
          {
            selector: 'node:selected',
            style: {
              'border-width': 3,
              'border-color': '#f0f6fc',
              'background-opacity': 0.6,
            },
          },
          {
            selector: '.highlighted',
            style: {
              'background-opacity': 0.8,
              'border-width': 3,
              'border-color': '#ffa657',
            },
          },
          {
            selector: '.dimmed',
            style: {
              'opacity': 0.15,
            },
          },
        ],
        layout: {
          name: 'dagre',
          rankDir: 'TB',
          nodeSep: 60,
          rankSep: 80,
          padding: 30,
        },
        minZoom: 0.1,
        maxZoom: 5,
      });

      cy.on('tap', 'node', function(evt) {
        var node = evt.target;
        showDetail(node.data());
      });

      cy.on('tap', function(evt) {
        if (evt.target === cy) {
          closeDetail();
        }
      });

      document.getElementById('stats').textContent =
        data.nodes.length + ' files, ' + data.edges.length + ' connections' +
        (data.analysis ? ', ' + data.analysis.methods.length + ' methods' : '');

      buildFileTree(data.nodes);
    }

    function buildFileTree(nodes) {
      var tree = document.getElementById('fileTree');
      var sorted = nodes.slice().sort(function(a, b) { return a.id.localeCompare(b.id); });

      tree.innerHTML = sorted.map(function(n) {
        return '<div class="tree-item" data-id="' + n.id + '">' +
          '<div class="dot" style="background:' + (TYPE_COLORS[n.type] || '#8b949e') + '"></div>' +
          '<span>' + n.id + '</span>' +
          '</div>';
      }).join('');

      tree.addEventListener('click', function(e) {
        var item = e.target.closest('.tree-item');
        if (!item) return;
        var id = item.dataset.id;
        var node = cy.getElementById(id);
        if (node.length) {
          cy.animate({ center: { eles: node }, zoom: 2 }, { duration: 300 });
          node.select();
          showDetail(node.data());
        }
      });
    }

    function showDetail(data) {
      var panel = document.getElementById('detailPanel');
      var title = document.getElementById('detailTitle');
      var content = document.getElementById('detailContent');

      panel.classList.add('open');
      title.textContent = data.id;

      var html = '<div class="detail-section">' +
        '<h3>Type</h3>' +
        '<span class="badge type-' + data.type + '">' + data.type + '</span>' +
        '</div>';

      if (data.route) {
        html += '<div class="detail-section"><h3>Route</h3><code>' + data.route + '</code></div>';
      }

      if (data.exports && data.exports.length > 0) {
        html += '<div class="detail-section"><h3>Exports</h3>' +
          data.exports.map(function(e) { return '<span class="badge type-util">' + e + '</span>'; }).join('') +
          '</div>';
      }

      if (data.methods && data.methods.length > 0) {
        html += '<div class="detail-section"><h3>Methods (' + data.methods.length + ')</h3>' +
          data.methods.map(function(m) {
            return '<div class="method-item">' +
              '<div class="name">' + m.name + '</div>' +
              '<div class="sig">' + m.signature + '</div>' +
              '<div class="purpose">' + m.purpose + '</div>' +
              '</div>';
          }).join('') +
          '</div>';
      }

      if (cy) {
        var node = cy.getElementById(data.id);
        var incoming = node.incomers('node').map(function(n) { return n.data('id'); });
        var outgoing = node.outgoers('node').map(function(n) { return n.data('id'); });

        if (incoming.length > 0) {
          html += '<div class="detail-section"><h3>Imported by (' + incoming.length + ')</h3>' +
            incoming.map(function(f) { return '<div class="tree-item" style="padding:4px 0;cursor:default;font-size:12px">' + f + '</div>'; }).join('') +
            '</div>';
        }
        if (outgoing.length > 0) {
          html += '<div class="detail-section"><h3>Imports (' + outgoing.length + ')</h3>' +
            outgoing.map(function(f) { return '<div class="tree-item" style="padding:4px 0;cursor:default;font-size:12px">' + f + '</div>'; }).join('') +
            '</div>';
        }
      }

      content.innerHTML = html;

      cy.elements().removeClass('highlighted dimmed');
      var selected = cy.getElementById(data.id);
      var connected = selected.neighborhood().add(selected);
      cy.elements().not(connected).addClass('dimmed');
      connected.addClass('highlighted');

      document.querySelectorAll('.tree-item').forEach(function(el) {
        el.classList.toggle('active', el.dataset.id === data.id);
      });
    }

    function closeDetail() {
      document.getElementById('detailPanel').classList.remove('open');
      cy.elements().removeClass('highlighted dimmed');
      document.querySelectorAll('.tree-item.active').forEach(function(el) { el.classList.remove('active'); });
    }

    document.getElementById('detailClose').addEventListener('click', closeDetail);

    var searchTimeout;
    document.getElementById('searchInput').addEventListener('input', function(e) {
      clearTimeout(searchTimeout);
      var query = e.target.value.trim();
      if (!query) {
        cy.elements().removeClass('highlighted dimmed');
        buildFileTree(graphData.nodes);
        return;
      }
      searchTimeout = setTimeout(function() {
        fetch('/nova-api/project-map/search?q=' + encodeURIComponent(query))
          .then(function(res) { return res.json(); })
          .then(function(data) {
            var matchIds = {};
            data.results.forEach(function(r) { matchIds[r.filePath] = true; });

            cy.elements().removeClass('highlighted dimmed');
            cy.nodes().forEach(function(node) {
              if (matchIds[node.data('id')]) {
                node.addClass('highlighted');
              } else {
                node.addClass('dimmed');
              }
            });

            var filtered = graphData.nodes.filter(function(n) { return matchIds[n.id]; });
            buildFileTree(filtered.length > 0 ? filtered : graphData.nodes);
          })
          .catch(function() {});
      }, 300);
    });

    function connectWs() {
      var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      var ws = new WebSocket(protocol + '//' + location.host + '/nova-ws');

      ws.onmessage = function(event) {
        try {
          var msg = JSON.parse(event.data);
          if (msg.type === 'index_updated' || msg.type === 'analysis_complete') {
            fetchData().then(function(data) {
              if (cy) cy.destroy();
              initGraph(data);
            });
          }
        } catch(e) {}
      };

      ws.onclose = function() { setTimeout(connectWs, 3000); };
    }

    fetchData().then(initGraph).catch(function(err) {
      document.querySelector('.loading').textContent = 'Failed to load project graph: ' + err.message;
    });
    connectWs();
  </script>
</body>
</html>`;
