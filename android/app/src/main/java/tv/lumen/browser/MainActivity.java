package tv.lumen.browser;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Lumen Browser: Lumen (the phone app) as the home screen, plus its own browser for watching.
 * The browser blocks ad and tracker sites, stops pop-ups and redirects to other websites, starts
 * the film by itself and makes it fill the screen. Back returns to Lumen and saves your place.
 */
@SuppressWarnings("deprecation")
public class MainActivity extends Activity {
    private static final String HOME = "https://appassets.androidplatform.net/assets/web/index.html";
    private FrameLayout root;
    private WebView home, player;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private WebViewAssetLoader assets;
    private final Set<String> blocked = new HashSet<>();
    private final Set<String> allowedSites = new HashSet<>();
    private long playerStarted;
    private JSONObject current;
    private double progT, progD;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        assets = new WebViewAssetLoader.Builder().addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        new Thread(this::loadBlocklist).start();
        home = makeHome();
        root.addView(home, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        home.loadUrl(HOME);
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) { super.onNewIntent(intent); handleIntent(intent); }

    // lumenbrowser://watch?url=… from Lumen Web in another browser
    private void handleIntent(Intent intent) {
        Uri u = intent == null ? null : intent.getData();
        if (u == null || !"lumenbrowser".equals(u.getScheme())) return;
        String url = u.getQueryParameter("url");
        if (url != null && url.startsWith("http")) openPlayer(url, new JSONObject());
    }

    // ---------------------------------------------------------------- home: Lumen itself
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private WebView makeHome() {
        WebView w = new WebView(this);
        w.setBackgroundColor(Color.BLACK);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        w.addJavascriptInterface(new HomeBridge(), "LumenNative");
        w.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) { return assets.shouldInterceptRequest(r.getUrl()); }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("appassets.androidplatform.net".equals(u.getHost())) return false;
                if ("brave".equals(u.getScheme()) || "intent".equals(u.getScheme())) return true;
                startActivity(new Intent(Intent.ACTION_VIEW, u)); // links in Settings (TMDB sign-up and so on) open in the normal browser
                return true;
            }
        });
        w.setWebChromeClient(new WebChromeClient() {
            @Override public void onShowCustomView(View view, CustomViewCallback cb) { showCustom(view, cb); } // trailers in full screen
            @Override public void onHideCustomView() { hideCustom(); }
        });
        return w;
    }

    private class HomeBridge {
        @JavascriptInterface public void watch(String url, String item) {
            ui.post(() -> { try { openPlayer(url, new JSONObject(item)); } catch (Exception e) { openPlayer(url, new JSONObject()); } });
        }
    }

    // ---------------------------------------------------------------- the player: an ad-free browser for one film
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void openPlayer(String url, JSONObject item) {
        closePlayer(false);
        current = item; progT = 0; progD = 0;
        playerStarted = System.currentTimeMillis();
        allowedSites.clear(); allowedSites.add(site(url));
        WebView w = new WebView(this);
        w.setBackgroundColor(Color.BLACK);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(true); // so every pop-up comes to onCreateWindow, where it is refused
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        w.addJavascriptInterface(new PlayerBridge(), "LumenPlayer");
        String inject = readAsset("inject.js").replace("__RESUME__", String.valueOf(item.optDouble("resumeAt", 0)));
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(w, inject, Collections.singleton("*")); // every frame, including embedded players
        }
        w.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                String host = r.getUrl().getHost();
                if (host != null && isBlocked(host)) return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
                return null;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if (!r.isForMainFrame()) return false;
                String scheme = r.getUrl().getScheme();
                if (!"http".equals(scheme) && !"https".equals(scheme)) return true; // no jumping out to other apps
                String target = site(r.getUrl().toString());
                if (allowedSites.contains(target)) return false;
                // the first few seconds: sites often hop to a mirror address, which is then allowed too
                if (System.currentTimeMillis() - playerStarted < 6000) { allowedSites.add(target); return false; }
                return true; // a redirect to a different website (usually an advert): stay put
            }
            @Override public void onPageFinished(WebView v, String u) {
                if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) v.evaluateJavascript(inject, null);
            }
        });
        w.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onCreateWindow(WebView v, boolean dialog, boolean gesture, Message msg) { return false; }
            @Override public void onShowCustomView(View view, CustomViewCallback cb) { showCustom(view, cb); }
            @Override public void onHideCustomView() { hideCustom(); }
        });
        player = w;
        root.addView(w, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        immersive(true);
        w.loadUrl(url);
    }

    private class PlayerBridge {
        @JavascriptInterface public void progress(double t, double d) { if (d > 0) { progT = t; progD = d; } }
    }

    private void closePlayer(boolean refresh) {
        hideCustom();
        if (player == null) return;
        WebView w = player; player = null;
        root.removeView(w);
        w.stopLoading(); w.loadUrl("about:blank"); w.destroy();
        immersive(false);
        if (current != null && current.has("id") && progD > 60) {
            try {
                JSONObject p = new JSONObject(current.toString()); p.put("t", progT); p.put("d", progD);
                home.evaluateJavascript("window.LUMEN_WEB && LUMEN_WEB.saveProgress(" + p + ");", null);
            } catch (Exception ignored) { }
        }
        if (refresh) home.evaluateJavascript("window.lumenRefresh && lumenRefresh();", null);
    }

    // ---------------------------------------------------------------- full screen
    private void showCustom(View view, WebChromeClient.CustomViewCallback cb) {
        hideCustom();
        customView = view; customCallback = cb;
        root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        immersive(true);
    }
    private void hideCustom() {
        if (customView == null) return;
        root.removeView(customView); customView = null;
        if (customCallback != null) customCallback.onCustomViewHidden();
        customCallback = null;
        if (player == null) immersive(false);
    }
    private void immersive(boolean on) {
        setRequestedOrientation(on ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c == null) return;
            if (on) { c.hide(WindowInsets.Type.systemBars()); c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE); }
            else c.show(WindowInsets.Type.systemBars());
        } else { // Android 8 to 10
            getWindow().getDecorView().setSystemUiVisibility(on ? View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE : 0);
        }
    }

    @Override
    public void onBackPressed() {
        if (customView != null && player == null) { hideCustom(); return; }
        if (player != null) { closePlayer(true); return; }
        if (home.canGoBack()) { home.goBack(); return; }
        super.onBackPressed();
    }

    @Override protected void onPause() { super.onPause(); if (player != null) player.onPause(); }
    @Override protected void onResume() { super.onResume(); if (player != null) player.onResume(); }

    // ---------------------------------------------------------------- blocking
    private void loadBlocklist() {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(getAssets().open("blocklist.txt")))) {
            Set<String> s = new HashSet<>();
            for (String line; (line = r.readLine()) != null; ) { line = line.trim(); if (!line.isEmpty() && !line.startsWith("#")) s.add(line); }
            synchronized (blocked) { blocked.addAll(s); }
        } catch (Exception ignored) { }
    }
    private boolean isBlocked(String host) {
        synchronized (blocked) {
            String h = host.toLowerCase();
            while (true) {
                if (blocked.contains(h)) return true;
                int dot = h.indexOf('.');
                if (dot < 0 || h.indexOf('.', dot + 1) < 0) return false;
                h = h.substring(dot + 1);
            }
        }
    }
    private static final Set<String> SLD = new HashSet<>(java.util.Arrays.asList("co", "com", "org", "net", "gov", "ac", "edu", "ltd", "plc", "me"));
    private static String site(String url) {
        String h; try { h = Uri.parse(url).getHost(); } catch (Exception e) { return ""; }
        if (h == null) return "";
        String[] p = h.toLowerCase().replaceFirst("^www\\.", "").split("\\.");
        if (p.length > 2 && p[p.length - 1].length() == 2 && SLD.contains(p[p.length - 2])) return p[p.length - 3] + "." + p[p.length - 2] + "." + p[p.length - 1];
        if (p.length >= 2) return p[p.length - 2] + "." + p[p.length - 1];
        return h;
    }
    private String readAsset(String name) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(getAssets().open(name)))) {
            StringBuilder b = new StringBuilder(); for (String l; (l = r.readLine()) != null; ) b.append(l).append('\n'); return b.toString();
        } catch (Exception e) { return ""; }
    }
}
