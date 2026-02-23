/**
 * Storyboard Export — frontend type
 */
export interface StoryboardExport {
  id: string;
  project_id: string;
  run_id: string;
  export_type: 'pdf_contact_sheet' | 'zip_frames';
  status: 'pending' | 'running' | 'complete' | 'failed';
  storage_path: string | null;
  public_url: string | null;
  meta: {
    frame_count?: number;
    panel_count?: number;
    unit_count?: number;
    missing_count?: number;
    missing_panel_ids?: string[];
    aspect_ratio?: string | null;
    style_preset?: string | null;
    created_at?: string;
  };
  error: string | null;
  created_at: string;
  created_by: string | null;
}
