#!/usr/bin/env node
// Единая точка обновления релиза.
//
// Правьте только release.json в корне репозитория, затем запустите:
//   node scripts/release.js
// Скрипт пересоберёт version.json (в корне и в docs/) и docs/index.html
// (объект RELEASE и продублированную для no-JS статическую вёрстку) из
// одних и тех же данных, так что версия, ссылка на APK, контрольная
// сумма, список актов и история версий никогда не разъезжаются.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(ROOT, "release.json");
const HTML_PATH = path.join(ROOT, "docs", "index.html");
const ROOT_VERSION_JSON_PATH = path.join(ROOT, "version.json");
const DOCS_VERSION_JSON_PATH = path.join(ROOT, "docs", "version.json");

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function fail(message) {
  console.error("release.js: " + message);
  process.exit(1);
}

function formatRuDate(iso) {
  const [y, m, d] = iso.split("-").map((v) => parseInt(v, 10));
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function pluralActs(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "акт";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "акта";
  return "актов";
}

function loadData() {
  if (!fs.existsSync(DATA_PATH)) fail(`не найден ${DATA_PATH}`);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch (e) {
    fail(`release.json содержит невалидный JSON: ${e.message}`);
  }

  const required = [
    "repo", "version", "versionCode", "releasedAt", "sizeBytes", "sha256",
    "minAndroid", "minSupportedVersionCode", "changelogRu", "acts", "history",
  ];
  for (const key of required) {
    if (data[key] === undefined) fail(`в release.json отсутствует поле "${key}"`);
  }
  if (!Array.isArray(data.acts) || data.acts.length === 0) {
    fail("release.json: поле acts должно быть непустым массивом");
  }
  if (!Array.isArray(data.history) || data.history.length === 0) {
    fail("release.json: поле history должно быть непустым массивом");
  }
  if (data.history[0].version !== data.version) {
    fail(
      `version ("${data.version}") не совпадает с history[0].version ` +
      `("${data.history[0].version}"). Первая запись истории должна ` +
      `описывать текущий релиз.`
    );
  }

  return data;
}

function buildDerived(data) {
  const apkUrl =
    `https://github.com/${data.repo}/releases/download/v${data.version}/` +
    `genesis-kodeks-${data.version}.apk`;
  // Один знак после запятой — то же округление, что apk_size_mb в
  // tool/release.sh (awk '%.1f'), чтобы значение на странице не
  // отличалось от того, что оператор видел при выпуске релиза.
  const sizeMb = (data.sizeBytes / (1024 * 1024)).toFixed(1);
  const displayDate = data.history[0].date;
  return { apkUrl, sizeMb, displayDate };
}

function buildVersionJson(data, derived) {
  return {
    latest_version: data.version,
    version_code: data.versionCode,
    released_at: data.releasedAt,
    apk_url: derived.apkUrl,
    sha256: data.sha256,
    size_bytes: data.sizeBytes,
    min_supported_version_code: data.minSupportedVersionCode,
    changelog_ru: data.changelogRu,
  };
}

function jsStr(value) {
  return JSON.stringify(value);
}

function buildReleaseScriptBlock(data, derived) {
  const actsLines = data.acts
    .map((act) => `      { title: ${jsStr(act.title)}, number: ${jsStr(act.number || "")}, redaction: ${jsStr(act.redaction || "")}, articles: ${act.articles} },`)
    .join("\n");

  const historyLines = data.history
    .map((h) => `      { version: ${jsStr(h.version)}, date: ${jsStr(h.date)}, changes: ${jsStr(h.changes)} },`)
    .join("\n");

  return `<script>
  /*
   * Эти данные генерируются автоматически скриптом scripts/release.js
   * из release.json — не редактируйте их здесь вручную, правки будут
   * потеряны при следующем запуске скрипта. Ниже в статической
   * разметке страницы те же значения продублированы построчно (нужно,
   * чтобы страница оставалась осмысленной при отключённом JavaScript);
   * scripts/release.js обновляет обе копии одновременно. Скрипт в
   * конце страницы перерисовывает разметку из этого объекта, когда
   * JavaScript включён.
   */
  const RELEASE = {
    version: ${jsStr(data.version)},
    versionCode: ${data.versionCode},
    date: ${jsStr(derived.displayDate)},
    sizeMb: ${jsStr(derived.sizeMb)},
    apkUrl: ${jsStr(derived.apkUrl)},
    sha256: ${jsStr(data.sha256)},
    minAndroid: ${jsStr(data.minAndroid)},
    telegramUrl: ${jsStr(data.telegramUrl || "")},
    acts: [
${actsLines}
    ],
    history: [
${historyLines}
    ]
  };
</script>`;
}

function buildActsRows(data) {
  return data.acts
    .map((act) => `          <tr>
            <td data-label="Акт">${act.title}</td>
            <td data-label="Номер">${act.number || ""}</td>
            <td data-label="Дата редакции">${act.redaction || ""}</td>
            <td class="num" data-label="Статей">${act.articles}</td>
          </tr>`)
    .join("\n");
}

function buildHistoryRows(data) {
  return data.history
    .map((h) => `      <div class="history-row">
        <div>
          <span class="history-version">${h.version}</span>
          <span class="history-date">${formatRuDate(h.date)}</span>
        </div>
        <div class="history-changes">${h.changes}</div>
      </div>`)
    .join("\n");
}

function replaceOrFail(html, regex, replacement, label) {
  if (!regex.test(html)) fail(`не найден блок "${label}" в docs/index.html — вёрстка изменилась сильнее, чем ожидает скрипт`);
  return html.replace(regex, replacement);
}

function buildHtml(data, derived) {
  // На Windows с core.autocrlf=true свежий git checkout (в т.ч. gh repo
  // clone, которым пользуется tool/release.sh) кладёт файл на диск с
  // CRLF — регэкспы ниже жёстко завязаны на "\n" в многострочных
  // блоках, так что нормализуем сразу при чтении, а не гадаем, в каком
  // состоянии сейчас рабочее дерево.
  let html = fs.readFileSync(HTML_PATH, "utf8").replace(/\r\n/g, "\n");

  html = replaceOrFail(
    html,
    /<script>[\s\S]*?<\/script>/,
    buildReleaseScriptBlock(data, derived),
    "RELEASE script"
  );

  html = replaceOrFail(
    html,
    /<span class="nav-version" id="nav-version">v[^<]*<\/span>/,
    `<span class="nav-version" id="nav-version">v${data.version}</span>`,
    "nav-version"
  );

  html = html.replace(
    /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\/v[\w.+-]+\/genesis-kodeks-[\w.+-]+\.apk/g,
    derived.apkUrl
  );

  html = replaceOrFail(
    html,
    /<span class="badge" id="cta-size">[^<]*<\/span>/,
    `<span class="badge" id="cta-size">${derived.sizeMb} МБ</span>`,
    "cta-size"
  );

  html = replaceOrFail(
    html,
    /<dd id="spec-version">[^<]*<\/dd>/,
    `<dd id="spec-version">${data.version}</dd>`,
    "spec-version"
  );

  html = replaceOrFail(
    html,
    /<dd id="spec-date">[^<]*<\/dd>/,
    `<dd id="spec-date">${formatRuDate(derived.displayDate)}</dd>`,
    "spec-date"
  );

  html = replaceOrFail(
    html,
    /<dd id="spec-size">[^<]*<\/dd>/,
    `<dd id="spec-size">${derived.sizeMb} МБ</dd>`,
    "spec-size"
  );

  html = replaceOrFail(
    html,
    /<dd id="spec-minos">[^<]*<\/dd>/,
    `<dd id="spec-minos">Android ${data.minAndroid}+</dd>`,
    "spec-minos"
  );

  html = replaceOrFail(
    html,
    /<tbody id="acts-table-body">[\s\S]*?<\/tbody>/,
    `<tbody id="acts-table-body">\n${buildActsRows(data)}\n        </tbody>`,
    "acts-table-body"
  );

  const actsCount = data.acts.length;
  html = replaceOrFail(
    html,
    /<caption id="acts-caption">[^<]*<\/caption>/,
    `<caption id="acts-caption">${actsCount} ${pluralActs(actsCount)} · по состоянию на дату сборки, указанную выше</caption>`,
    "acts-caption"
  );

  html = replaceOrFail(
    html,
    /<div class="verify-label">SHA-256 · GENESIS-KODEKS-[^<]*<\/div>/,
    `<div class="verify-label">SHA-256 · GENESIS-KODEKS-${data.version}.APK</div>`,
    "verify-label"
  );

  html = replaceOrFail(
    html,
    /<code class="sha" id="sha256-value">[^<]*<\/code>/,
    `<code class="sha" id="sha256-value">${data.sha256}</code>`,
    "sha256-value"
  );

  html = replaceOrFail(
    html,
    /<div id="history-list">[\s\S]*?\n    <\/div>\n  <\/section>/,
    `<div id="history-list">\n${buildHistoryRows(data)}\n    </div>\n  </section>`,
    "history-list"
  );

  return html;
}

function writeIfChanged(filePath, content) {
  const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
  if (prev === content) {
    console.log(`  без изменений  ${path.relative(ROOT, filePath)}`);
    return;
  }
  fs.writeFileSync(filePath, content);
  console.log(`  обновлён        ${path.relative(ROOT, filePath)}`);
}

function main() {
  const data = loadData();
  const derived = buildDerived(data);

  const versionJson = JSON.stringify(buildVersionJson(data, derived), null, 2) + "\n";
  const html = buildHtml(data, derived);

  console.log(`Релиз ${data.version} (versionCode ${data.versionCode}), актов: ${data.acts.length}`);
  writeIfChanged(ROOT_VERSION_JSON_PATH, versionJson);
  writeIfChanged(DOCS_VERSION_JSON_PATH, versionJson);
  writeIfChanged(HTML_PATH, html);
  console.log("Готово.");
}

main();
