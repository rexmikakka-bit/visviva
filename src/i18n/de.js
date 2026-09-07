// German. Keys are the English strings — see src/lib/i18n.js.
//
// Terminology follows EVE's own German client where the client has a word for it, which is why
// "Skill", "Fitting", "Booster", "Hardpoint" and "Slot" stay as they are: CCP leaves them English in
// German EVE, and a player who reads "Fertigkeit" here would not recognise it from the game. Item
// names are never translated at all.
//
// A value may be a form MAP instead of a string where the phrase counts something. German takes the
// same two forms as English, so `one` and `other` are all that appear here.
export default {
  "+{n} more": "+{n} weitere",
  "Abyssal Rolls (mutated modules)": "Abyssal-Rolls (mutierte Module)",
  "All V": "Alle V",
  "All V (Max)": "Alle V (Max)",
  "All skill requirements met": "Alle Skillanforderungen erfüllt",
  "All skill requirements met — tap to change pilot": "Alle Skillanforderungen erfüllt — tippen, um den Piloten zu wechseln",
  "All sources cache for 1 hour per hub.": "Alle Quellen werden pro Hub 1 Stunde zwischengespeichert.",
  "Alpha": "Alpha",
  "Always open fits in a new tab": "Fittings immer in einem neuen Tab öffnen",
  "Auto-fill hardpoints": "Hardpoints automatisch füllen",
  "Backup": "Backup",
  "Boosters": "Booster",
  "CCP's alpha clone ceiling": "CCPs Obergrenze für Alpha-Klone",
  "Cancel": "Abbrechen",
  "Cargo": "Frachtraum",
  "Choose a hull": "Rumpf auswählen",
  "Clear All": "Alle löschen",
  "Click again to untrain": "Erneut klicken, um zurückzusetzen",
  "Copied to clipboard!": "In die Zwischenablage kopiert!",
  "Copy EFT to Clipboard": "EFT in die Zwischenablage kopieren",
  "Dark": "Dunkel",
  "Delete {name}": "{name} löschen",
  "Drones": "Drohnen",
  "ESI, market, overrides": "ESI, Markt, Overrides",
  "EVE Online Fitting Tool": "EVE-Online-Fitting-Tool",
  "Effects": "Effekte",
  "Every skill trained to V": "Jeder Skill auf V trainiert",
  "Export EFT Fit": "EFT-Fitting exportieren",
  "Export Fit": "Fitting exportieren",
  "Export Snapshot": "Snapshot exportieren",
  "Fit Tabs": "Fitting-Tabs",
  "Fitting": "Fitting",
  "Fitting calculations are validated against {pyfa}, and its environment-effect data is used with thanks. pyfa is licensed GPLv3.":
    "Die Fitting-Berechnungen sind gegen {pyfa} validiert, dessen Umgebungseffekt-Daten mit Dank verwendet werden. pyfa steht unter der GPLv3.",
  "Formatting": "Formatierung",
  "From EFT or an EVE character": "Aus EFT oder von einem EVE-Charakter",
  "Implants": "Implantate",
  "Import Fit": "Fitting importieren",
  "Interface": "Oberfläche",
  "Language": "Sprache",
  "Light": "Hell",
  "Load": "Laden",
  "Loaded Charges (e.g. Hail L)": "Geladene Charges (z. B. Hail L)",
  "Market": "Markt",
  "Market Hub": "Markt-Hub",
  "Module Browser": "Modul-Browser",
  "New Fit": "Neues Fitting",
  "None": "Keine",
  "Not synced — sync in Settings → ESI": "Nicht synchronisiert — unter Einstellungen → ESI synchronisieren",
  "Off: opening a fit replaces the tab you are in, and the + in the tab strip opens a new one. On: every fit you open gets its own tab, like pyfa.":
    "Aus: Ein geöffnetes Fitting ersetzt den Tab, in dem du dich befindest, und das + in der Tab-Leiste öffnet einen neuen. An: Jedes geöffnete Fitting bekommt seinen eigenen Tab, wie in pyfa.",
  "On: picking a turret or launcher from the browser fills every free matching hardpoint, not just the slot you tapped. Off: it fills only that one slot — use Fill Hardpoints on an existing module to fill the rest by hand.":
    "An: Ein Turret oder Launcher aus dem Browser füllt jeden freien passenden Hardpoint, nicht nur den angetippten Slot. Aus: Es wird nur dieser eine Slot gefüllt — nutze „Hardpoints füllen“ an einem vorhandenen Modul, um den Rest von Hand zu füllen.",
  "Optimize Fit Price": "Fitting-Preis optimieren",
  "Pilot": "Pilot",
  "Pilot: all skill requirements met": "Pilot: Alle Skillanforderungen erfüllt",
  "Pilot: {n} skills insufficient": { one: "Pilot: {n} Skill unzureichend", other: "Pilot: {n} Skills unzureichend" },
  "Price Source": "Preisquelle",
  "Profile name...": "Profilname...",
  "Rename {name}": "{name} umbenennen",
  "Report a bug or suggest something": "Einen Fehler melden oder etwas vorschlagen",
  "Save": "Speichern",
  "Save As Skill Profile…": "Als Skill-Profil speichern…",
  "Saved profile — {n} trained skills": { one: "Gespeichertes Profil — {n} trainierter Skill", other: "Gespeichertes Profil — {n} trainierte Skills" },
  "Select what to include in the exported fit text": "Wähle aus, was im exportierten Fitting-Text enthalten sein soll",
  "Send Feedback": "Feedback senden",
  "Set to level {n}": "Auf Level {n} setzen",
  "Settings": "Einstellungen",
  "Shareable image of the fit": "Teilbares Bild des Fittings",
  "Ship, module and charge names stay in English in every language — they are what EFT import and export speak, and what the search box matches on.":
    "Schiffs-, Modul- und Charge-Namen bleiben in jeder Sprache englisch — sie sind das, was EFT-Import und -Export sprechen und worauf die Suche zugreift.",
  "Skills": "Skills",
  "Swap modules to reduce cost": "Module tauschen, um Kosten zu senken",
  "System": "System",
  "System follows your device's light/dark setting; the rest pin the app regardless. Amarr, Sansha and Intaki are dark themes, in imperial gold, Nation oxblood and cold slate.":
    "System folgt der Hell-/Dunkel-Einstellung deines Geräts; die übrigen legen die App unabhängig davon fest. Amarr, Sansha und Intaki sind dunkle Themes in imperialem Gold, Nation-Ochsenblut und kaltem Schiefer.",
  "The pilot is saved with this fit. Skills you have never set count as level V.":
    "Der Pilot wird mit diesem Fitting gespeichert. Nie gesetzte Skills zählen als Level V.",
  "The sheet in Settings → Skills": "Das Skillblatt unter Einstellungen → Skills",
  "The strip holds up to 8 tabs; past that the oldest drops off. Closing a tab never deletes the fit.":
    "Die Leiste fasst bis zu 8 Tabs; darüber hinaus fällt der älteste weg. Einen Tab zu schließen löscht nie das Fitting.",
  "Theme": "Theme",
  "To clipboard or an EVE character": "In die Zwischenablage oder an einen EVE-Charakter",
  "Unofficial, fan-made tool — not affiliated with, endorsed by, or sponsored by Fenris Creations. EVE Online and all related materials are used with limited permission; all intellectual property belongs to Fenris Creations.":
    "Inoffizielles Fan-Tool — nicht verbunden mit, unterstützt oder gesponsert von Fenris Creations. EVE Online und alle zugehörigen Materialien werden mit eingeschränkter Genehmigung verwendet; sämtliche geistigen Eigentumsrechte liegen bei Fenris Creations.",
  "Wrap in a code block (for Discord)": "In einen Codeblock einfassen (für Discord)",
  "Your Skills ({sheet})": "Deine Skills ({sheet})",
  "lowest sell order in the hub's region. One small request per item.":
    "niedrigste Verkaufsorder in der Region des Hubs. Eine kleine Anfrage pro Item.",
  "sell-order percentile, matching pyfa's default. One request for the whole fit; the fastest option.":
    "Verkaufsorder-Perzentil, wie pyfas Standard. Eine Anfrage für das gesamte Fitting; die schnellste Option.",
  "{group} · needed by {items}": "{group} · benötigt von {items}",
  "{n} skills insufficient": { one: "{n} Skill unzureichend", other: "{n} Skills unzureichend" },
  "{n} skills insufficient — tap for details": { one: "{n} Skill unzureichend — für Details tippen", other: "{n} Skills unzureichend — für Details tippen" },
  "{n} trained skills": { one: "{n} trainierter Skill", other: "{n} trainierte Skills" },
  "{skills} skills across {groups} groups — every skill the engine reads plus every skill a fittable item requires. Unset skills count as level V. Alpha is CCP's own clone ceiling, from the game data.":
    "{skills} Skills in {groups} Gruppen — jeder Skill, den die Engine liest, plus jeder Skill, den ein fittbares Item benötigt. Nicht gesetzte Skills zählen als Level V. Alpha ist CCPs eigene Klon-Obergrenze aus den Spieldaten.",
};
