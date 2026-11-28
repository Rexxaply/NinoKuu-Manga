package __PKG__;

// Plugin kecil Ninokuu: hitung & bersihkan cache aplikasi di HP (cache WebView berisi gambar sampul & halaman komik).
// Dipasang oleh .github/workflows/apk.yml (package diganti otomatis, didaftarkan di MainActivity).
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.os.Handler;
import android.os.Looper;
import android.view.MotionEvent;
import android.view.Window;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import android.content.Context;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.io.File;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "NinokuuCache")
public class NinokuuCachePlugin extends Plugin {
    // Mode fullscreen: sistem Android hanya menangkap tarikan dari tepi paling atas (sempit). Tarikan ke bawah dari
    // ±40dp teratas layar (≥30dp) juga memunculkan bilah status, lalu disembunyikan lagi setelah 3 detik. Bila sistem
    // sudah memunculkannya sendiri (tarikan tepat di tepi), tidak ada yang diubah. Halaman diberi tahu lewat event
    // "sbPull"/"sbPullEnd" untuk menampilkan latar gelap tipis di belakang bilah.
    private boolean fsHidden = false, tracking = false;
    private float startY = 0;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable rehide = () -> {
        if (fsHidden) setBars(true);
        notifyListeners("sbPullEnd", new JSObject());
    };

    private void setBars(boolean hide) {
        Window w = getActivity().getWindow();
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        if (hide) c.hide(WindowInsetsCompat.Type.statusBars());
        else c.show(WindowInsetsCompat.Type.statusBars());
    }

    @Override
    public void load() {
        try {
            WebView wv = getBridge().getWebView();
            final float dp = getContext().getResources().getDisplayMetrics().density;
            wv.setOnTouchListener((v, e) -> {
                if (!fsHidden) return false;
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        tracking = e.getRawY() < 40 * dp;
                        startY = e.getRawY();
                        break;
                    case MotionEvent.ACTION_MOVE:
                        if (tracking && e.getRawY() - startY > 30 * dp) {
                            tracking = false;
                            WindowInsetsCompat ri = androidx.core.view.ViewCompat.getRootWindowInsets(getActivity().getWindow().getDecorView());
                            if (ri != null && ri.isVisible(WindowInsetsCompat.Type.statusBars())) break;   // sistem sudah memunculkannya
                            setBars(false);
                            notifyListeners("sbPull", new JSObject());
                            ui.removeCallbacks(rehide);
                            ui.postDelayed(rehide, 3000);
                        }
                        break;
                    default:
                        tracking = false;
                }
                return false;
            });
        } catch (Exception ignored) { }
    }

    private static long sizeOf(File f) {
        if (f == null || !f.exists()) return 0;
        if (f.isFile()) return f.length();
        long s = 0;
        File[] list = f.listFiles();
        if (list != null) for (File c : list) s += sizeOf(c);
        return s;
    }

    private static void wipe(File dir) {
        File[] list = dir == null ? null : dir.listFiles();
        if (list == null) return;
        for (File c : list) {
            if (c.isDirectory()) wipe(c);
            //noinspection ResultOfMethodCallIgnored
            c.delete();
        }
    }

    private long total() {
        return sizeOf(getContext().getCacheDir()) + sizeOf(getContext().getExternalCacheDir());
    }

    @PluginMethod
    public void size(PluginCall call) {
        new Thread(() -> {
            JSObject r = new JSObject();
            r.put("bytes", total());
            call.resolve(r);
        }).start();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        final long before = total();
        getActivity().runOnUiThread(() -> {
            try { getBridge().getWebView().clearCache(true); } catch (Exception ignored) { }
            new Thread(() -> {
                wipe(getContext().getCacheDir());
                wipe(getContext().getExternalCacheDir());
                long after = total();
                JSObject r = new JSObject();
                r.put("before", before);
                r.put("after", after);
                r.put("freed", Math.max(0, before - after));
                call.resolve(r);
            }).start();
        });
    }

    // Layar penuh saat membaca: bilah status disembunyikan dengan perilaku "sementara" (transient). Bila ditarik dari
    // atas, bilah status muncul transparan di atas halaman lalu hilang sendiri setelah beberapa detik, tanpa perlu
    // mengetuk halaman. (StatusBar.hide() bawaan memakai perilaku default: setelah ditarik, bilah tetap tampil.)
    @PluginMethod
    public void bars(PluginCall call) {
        boolean hide = Boolean.TRUE.equals(call.getBoolean("hide", false));
        getActivity().runOnUiThread(() -> {
            try {
                fsHidden = hide;
                ui.removeCallbacks(rehide);
                setBars(hide);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    // Tinggi bilah status (px CSS), tetap sama walau bilah sedang disembunyikan. Dipakai halaman sebagai jarak aman atas
    // selama mode fullscreen, supaya tata letak tidak bergeser saat bilah dimunculkan/disembunyikan.
    @PluginMethod
    public void insets(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                WindowInsetsCompat ri = androidx.core.view.ViewCompat.getRootWindowInsets(getActivity().getWindow().getDecorView());
                float dp = getContext().getResources().getDisplayMetrics().density;
                JSObject r = new JSObject();
                r.put("top", ri == null ? 0 : Math.round(ri.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.statusBars()).top / dp));
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    // Cek chapter baru di latar belakang (lihat NinokuuBgWorker): simpan alamat server & kunci, lalu jadwalkan
    // ±tiap 30 menit saat ada internet. Dipanggil ulang tidak menggandakan jadwal (KEEP).
    @PluginMethod
    public void bgSetup(PluginCall call) {
        String url = call.getString("url", ""), key = call.getString("key", ""), apikey = call.getString("apikey", "");
        if (url.isEmpty() || key.isEmpty()) { call.reject("url/key kosong"); return; }
        Context ctx = getContext();
        ctx.getSharedPreferences(NinokuuBgWorker.PREFS, Context.MODE_PRIVATE).edit()
            .putString("url", url).putString("key", key).putString("apikey", apikey).apply();
        Constraints cons = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(NinokuuBgWorker.class, 30, TimeUnit.MINUTES)
            .setConstraints(cons).build();
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("ninokuu-bg", ExistingPeriodicWorkPolicy.KEEP, req);
        call.resolve();
    }

    @PluginMethod
    public void bgStop(PluginCall call) {
        Context ctx = getContext();
        WorkManager.getInstance(ctx).cancelUniqueWork("ninokuu-bg");
        ctx.getSharedPreferences(NinokuuBgWorker.PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        call.resolve();
    }
}
