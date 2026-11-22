package __PKG__;

// Cek chapter baru di latar belakang (aplikasi ditutup), untuk sumber yang menolak server Ninokuu
// (Komiku, Shinigami, WestManga).
// Hanya aktif di HP akun developer: HP ini mengecek komik berlonceng milik SEMUA pengguna.
// Dijalankan WorkManager ±tiap 30 menit saat ada internet. Alurnya:
//   1. minta daftar komik yang perlu dicek ke server (action bg_list, memakai kunci latar belakang; maks. 60, yang
//      paling lama tidak dicek dulu)
//   2. buka halaman komiknya lewat jaringan HP (seperti browser biasa)
//   3. kirim daftar chapter ke server (action bg_report); server yang mengirim notifikasi ke semua pengikut
// Dipasang oleh .github/workflows/apk.yml (package diganti otomatis).
import android.content.Context;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

public class NinokuuBgWorker extends Worker {
    static final String PREFS = "ninokuu_bg";
    private static final String UA = "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
    private static final int MAX_HTML = 3 * 1024 * 1024;

    public NinokuuBgWorker(@NonNull Context ctx, @NonNull WorkerParameters p) { super(ctx, p); }

    @NonNull
    @Override
    public Result doWork() {
        SharedPreferences sp = getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String fn = sp.getString("url", ""), apikey = sp.getString("apikey", ""), key = sp.getString("key", "");
        if (fn.isEmpty() || key.isEmpty()) return Result.success();
        try {
            JSONObject list = post(fn, apikey, new JSONObject().put("action", "bg_list").put("key", key));
            if (list == null) return Result.success();
            JSONArray items = list.optJSONArray("items");
            if (items == null) return Result.success();
            for (int i = 0; i < items.length() && !isStopped(); i++) {
                JSONObject it = items.getJSONObject(i);
                String src = it.optString("source"), id = it.optString("comic_id");
                try {
                    JSONArray chs;
                    if ("komiku".equals(src) && id.matches("^https://([a-z0-9-]+\\.)?komiku\\.(org|to|id)/.*")) chs = komikuChapters(id);
                    else if ("shinigami".equals(src) && id.matches("^[\\w-]{1,80}$")) chs = shngChapters(id);
                    else if ("westmanga".equals(src) && id.matches("^[\\w.-]{1,200}$")) chs = westChapters(id);
                    else continue;
                    if (chs.length() > 0) post(fn, apikey, new JSONObject().put("action", "bg_report").put("key", key)
                            .put("source", src).put("comic_id", id).put("chapters", chs));
                } catch (Exception ignored) { /* komik ini gagal dibuka: coba lagi di jadwal berikutnya */ }
            }
        } catch (Exception e) {
            return Result.retry();
        }
        return Result.success();
    }

    private static String text(String html) {
        return html.replaceAll("<[^>]+>", " ").replace("&amp;", "&").replace("&nbsp;", " ").replaceAll("\\s+", " ").trim();
    }

    private static final Pattern ROW = Pattern.compile("class=[\"'][^\"']*\\bjudulseries\\b[^\"']*[\"'][^>]*>([\\s\\S]*?)</td>", Pattern.CASE_INSENSITIVE);
    private static final Pattern LINK = Pattern.compile("<a\\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>([\\s\\S]*?)</a>", Pattern.CASE_INSENSITIVE);
    private static final Pattern NUM1 = Pattern.compile("(?:chapter|chap|ch\\.?|bab|episode|ep\\.?)\\s*[-:#]?\\s*(\\d+(?:[.,]\\d+)?)", Pattern.CASE_INSENSITIVE);
    private static final Pattern NUM2 = Pattern.compile("(?:chapter|ch|bab|episode|ep)[-_]?(\\d+(?:[-.]\\d+)?)/?$", Pattern.CASE_INSENSITIVE);
    private static final Pattern NUM3 = Pattern.compile("(\\d+(?:\\.\\d+)?)");

    // chapter terbaru ada di baris paling atas tabel Daftar_Chapter; 50 baris pertama sudah cukup
    private JSONArray komikuChapters(String comicUrl) throws Exception {
        String html = get(comicUrl);
        int at = html.indexOf("Daftar_Chapter");
        if (at < 0) return new JSONArray();
        JSONArray out = new JSONArray();
        Matcher m = ROW.matcher(html);
        m.region(at, html.length());
        while (m.find() && out.length() < 50) {
            Matcher a = LINK.matcher(m.group(1));
            if (!a.find()) continue;
            String href = new URL(new URL(comicUrl), a.group(1)).toString(), name = text(a.group(2));
            Matcher n = NUM1.matcher(name);
            String ch = null;
            if (n.find()) ch = n.group(1);
            else { Matcher n2 = NUM2.matcher(href); if (n2.find()) ch = n2.group(1); else { Matcher n3 = NUM3.matcher(name); if (n3.find()) ch = n3.group(1); } }
            if (ch == null) continue;
            ch = ch.replaceFirst("[,-]", ".").replaceFirst("^0+(?=\\d)", "");
            out.put(new JSONObject().put("id", href).put("ch", ch));
        }
        return out;
    }

    private static String get(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(30000); c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", UA);
        c.setRequestProperty("Accept", "text/html,application/xhtml+xml,*/*;q=0.8");
        c.setRequestProperty("Accept-Language", "id-ID,id;q=0.9,en;q=0.7");
        c.setRequestProperty("Referer", "https://komiku.org/");
        try {
            if (c.getResponseCode() / 100 != 2) throw new Exception("HTTP " + c.getResponseCode());
            if (!c.getURL().getHost().matches("^([a-z0-9-]+\\.)?komiku\\.(org|to|id)$")) throw new Exception("pengalihan ke situs lain");
            return read(c.getInputStream(), MAX_HTML, true);
        } finally { c.disconnect(); }
    }

    // API JSON (Shinigami, WestManga); code = status HTTP bila gagal
    private static class HttpErr extends Exception { final int code; HttpErr(int c) { super("HTTP " + c); code = c; } }
    private static JSONObject getJson(String url, String origin, String visit) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(30000);
        c.setRequestProperty("User-Agent", UA);
        c.setRequestProperty("Accept", "application/json, text/plain, */*");
        c.setRequestProperty("Accept-Language", "id-ID,id;q=0.9,en;q=0.7");
        c.setRequestProperty("Origin", origin); c.setRequestProperty("Referer", origin + "/");
        if (visit != null && !visit.isEmpty()) c.setRequestProperty("X-WM-Visit", visit);
        try {
            if (c.getResponseCode() / 100 != 2) throw new HttpErr(c.getResponseCode());
            return new JSONObject(read(c.getInputStream(), 4 * 1024 * 1024, false));
        } finally { c.disconnect(); }
    }
    private static String num(Object v) {
        String t = String.valueOf(v == null ? "" : v).trim().replace(",", ".");
        if (t.isEmpty() || "null".equals(t)) return null;
        return t.replaceFirst("\\.0+$", "");
    }

    // Shinigami: daftar chapter dari api.shinigami.io (sama seperti aplikasi)
    private JSONArray shngChapters(String id) throws Exception {
        JSONObject j = getJson("https://api.shinigami.io/v1/chapter/" + id + "/list?limit=2000", "https://s1.shinigami.mx", null);
        JSONArray d = j.optJSONArray("data"), out = new JSONArray();
        if (d == null) return out;
        for (int i = 0; i < d.length(); i++) {
            JSONObject c = d.getJSONObject(i);
            String cid = c.optString("chapter_id"), ch = num(c.opt("chapter_number"));
            if (!cid.isEmpty() && ch != null) out.put(new JSONObject().put("id", cid).put("ch", ch));
        }
        return out;
    }

    // WestManga: butuh token kunjungan (header X-WM-Visit); coba domain cermin bila yang pertama gagal
    private static final String[] WEST = { "https://v1.westmanga.my", "https://v1.westmanga.top" };
    private String westBase = WEST[0], westTok = null;
    private JSONArray westChapters(String slug) throws Exception {
        Exception last = null;
        for (int b = 0; b < WEST.length; b++) {
            String base = b == 0 ? westBase : (westBase.equals(WEST[0]) ? WEST[1] : WEST[0]);
            for (int force = 0; force < 2; force++) {
                try {
                    if (westTok == null || force == 1) {
                        try { JSONObject t = getJson(base + "/api/visit-token", base, null); westTok = t.optString("token"); } catch (Exception e) { westTok = ""; }
                    }
                    JSONObject j = getJson(base + "/api/comic/" + slug, base, westTok);
                    westBase = base;
                    JSONObject d = j.optJSONObject("data");
                    JSONArray cs = d == null ? null : d.optJSONArray("chapters"), out = new JSONArray();
                    if (cs == null) return out;
                    for (int i = 0; i < cs.length(); i++) {
                        JSONObject c = cs.getJSONObject(i);
                        String cid = c.optString("slug"), ch = num(c.opt("number"));
                        if (!cid.isEmpty() && ch != null) out.put(new JSONObject().put("id", cid).put("ch", ch));
                    }
                    return out;
                } catch (HttpErr e) { last = e; westTok = null; if (e.code != 403 && e.code != 404) break; }
                catch (Exception e) { last = e; break; }
            }
        }
        throw last != null ? last : new Exception("WestManga tidak bisa dihubungi");
    }

    private static JSONObject post(String fn, String apikey, JSONObject body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(fn).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(60000); c.setDoOutput(true); c.setRequestMethod("POST");
        c.setRequestProperty("Content-Type", "application/json");
        if (!apikey.isEmpty()) { c.setRequestProperty("apikey", apikey); c.setRequestProperty("Authorization", "Bearer " + apikey); }
        try {
            try (OutputStream os = c.getOutputStream()) { os.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            int code = c.getResponseCode();
            if (code == 401) return null;   // kunci tidak berlaku lagi (keluar akun / kunci diganti)
            if (code / 100 != 2) throw new Exception("HTTP " + code);
            return new JSONObject(read(c.getInputStream(), 512 * 1024, false));
        } finally { c.disconnect(); }
    }

    // komik=true: berhenti mengunduh begitu tabel chapter sudah memuat 50 baris (hemat kuota: sisa halaman berisi
    // chapter lama yang tidak dibutuhkan)
    private static String read(InputStream in, int max, boolean komik) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        StringBuilder mark = komik ? new StringBuilder() : null;
        int n, rows = 0, at = -1;
        while ((n = in.read(buf)) > 0) {
            bo.write(buf, 0, Math.min(n, max - bo.size()));
            if (bo.size() >= max) break;
            if (mark != null) {
                mark.append(new String(buf, 0, n, StandardCharsets.ISO_8859_1));
                if (at < 0) at = mark.indexOf("Daftar_Chapter");
                if (at >= 0) {
                    int i = at; rows = 0;
                    while ((i = mark.indexOf("judulseries", i + 1)) >= 0) rows++;
                    if (rows > 51) break;
                }
            }
        }
        in.close();
        return bo.toString("UTF-8");
    }
}
