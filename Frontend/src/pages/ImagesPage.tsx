import { ImageIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const MOCK_IMAGES = [
  { id: "1", title: "Photosynthesis Diagram", date: "2026-03-03", type: "Diagram" },
  { id: "2", title: "Newton's Laws Flowchart", date: "2026-03-02", type: "Flowchart" },
  { id: "3", title: "Cell Division Mindmap", date: "2026-03-01", type: "Mindmap" },
  { id: "4", title: "Water Cycle Diagram", date: "2026-02-28", type: "Diagram" },
  { id: "5", title: "French Revolution Timeline", date: "2026-02-27", type: "Flowchart" },
  { id: "6", title: "Data Structures Mindmap", date: "2026-02-25", type: "Mindmap" },
];

const ImagesPage = () => {
  return (
    <div className="p-4 md:p-6 overflow-y-auto h-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Generated Images</h1>
        <p className="text-sm text-muted-foreground mt-1">All your AI-generated diagrams, flowcharts, and mindmaps</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {MOCK_IMAGES.map((img) => (
          <Card key={img.id} className="bg-card border-border hover:border-primary/40 transition-all duration-200 cursor-pointer group hover:glow-blue-sm">
            <CardContent className="p-0">
              <div className="aspect-video bg-secondary/50 rounded-t-xl flex items-center justify-center">
                <ImageIcon className="w-10 h-10 text-muted-foreground/40 group-hover:text-primary/40 transition-colors" />
              </div>
              <div className="p-4">
                <h3 className="text-sm font-semibold text-foreground truncate">{img.title}</h3>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-muted-foreground">{img.date}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary">{img.type}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default ImagesPage;
