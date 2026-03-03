import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useLanguage, LANGUAGES } from "@/contexts/LanguageContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SettingsPage = () => {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="p-4 md:p-6 overflow-y-auto h-full space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Customize your Study Buddy experience.</p>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Language</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={language} onValueChange={(v) => setLanguage(v as any)}>
            <SelectTrigger className="w-full bg-secondary border-border text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang.code} value={lang.code} className="text-foreground">
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { label: "Goal reminders", desc: "Get notified about daily goals" },
            { label: "Quiz reminders", desc: "Reminder to practice quizzes" },
            { label: "Study streak alerts", desc: "Don't break your streak!" },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between">
              <div>
                <Label className="text-sm text-foreground">{item.label}</Label>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
              <Switch className="data-[state=checked]:bg-primary" />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base text-foreground">AI Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { label: "Simplified explanations", desc: "AI explains in simple terms by default", defaultOn: true },
            { label: "Auto-generate flashcards", desc: "Create flashcards from chat topics" },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between">
              <div>
                <Label className="text-sm text-foreground">{item.label}</Label>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
              <Switch defaultChecked={item.defaultOn} className="data-[state=checked]:bg-primary" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsPage;
