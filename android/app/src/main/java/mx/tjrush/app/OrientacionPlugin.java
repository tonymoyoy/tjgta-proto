package mx.tjrush.app;

import android.content.Context;
import android.content.pm.ActivityInfo;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Orientacion de la pantalla elegida en Opciones: "auto" (gira con el telefono), "horizontal" o "vertical"
// (las dos siguen el sensor para poder voltear el telefono). Se guarda para aplicarla al abrir la app.
@CapacitorPlugin(name = "Orientacion")
public class OrientacionPlugin extends Plugin {

    static final String PREFS = "tjrush", KEY = "orientacion";

    static int modo(String m) {
        if ("horizontal".equals(m)) return ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        if ("vertical".equals(m)) return ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
        return ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR;
    }

    static String guardado(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "auto");
    }

    @PluginMethod
    public void set(PluginCall call) {
        String m = call.getString("modo", "auto");
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, m).apply();
        getActivity().runOnUiThread(() -> getActivity().setRequestedOrientation(modo(m)));
        call.resolve();
    }
}
