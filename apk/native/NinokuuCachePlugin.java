package __PKG__;

// Plugin kecil Ninokuu: hitung & bersihkan cache aplikasi di HP (cache WebView berisi gambar sampul & halaman komik).
// Dipasang oleh .github/workflows/apk.yml (package diganti otomatis, didaftarkan di MainActivity).
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import java.io.File;

@CapacitorPlugin(name = "NinokuuCache")
public class NinokuuCachePlugin extends Plugin {
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
                Window w = getActivity().getWindow();
                WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
                c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                if (hide) c.hide(WindowInsetsCompat.Type.statusBars());
                else c.show(WindowInsetsCompat.Type.statusBars());
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }
}
