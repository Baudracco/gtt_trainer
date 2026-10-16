<?php
declare(strict_types=1);
namespace GttTrainer;

/**
 * Self-contained escaped HTML and PDF for one exact route revision.
 *
 * Geometry renders as an SVG from stored vertices. Only local normalized photo
 * thumbnails may be embedded; PDF generation does not fetch remote resources.
 */
final class Report
{
    /**
     * Render escaped instructions, ordered stops, source attribution and the exact revision geometry.
     * @param array $photos Local JPEG data URLs produced by MediaRepository::reportImages.
     */
    public static function html(array $route, string $lang = 'es', array $photos = []): string
    {
        $labels = [
            'es' => ['Reporte de recorrido','Revisión','Estado','Paradas','Instrucciones','Observaciones','Posto cambio','Fuente','Distancia','Sentido','Sin observaciones','Generado'],
            'it' => ['Scheda percorso','Revisione','Stato','Fermate','Istruzioni','Osservazioni','Posto cambio','Fonte','Distanza','Direzione','Nessuna osservazione','Generato'],
            'en' => ['Route report','Revision','Status','Stops','Instructions','Notes','Change post','Source','Distance','Direction','No notes','Generated'],
        ];
        $t = $labels[$lang] ?? $labels['es'];
        $e = static fn(mixed $text): string => htmlspecialchars((string) $text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $length = 0;
        $coords = $route['geometry']['coordinates'];
        for ($i = 1; $i < count($coords); ++$i) $length += RouteValidator::distance($coords[$i - 1], $coords[$i]);
        // Render the exact fixed geometry as an inline SVG with no external tiles or remote fetches.
        $xs = array_column($coords, 0); $ys = array_column($coords, 1);
        $cos = max(.01, cos(deg2rad(array_sum($ys) / count($ys))));
        $width = max(.00001, (max($xs) - min($xs)) * $cos);
        $height = max(.00001, max($ys) - min($ys));
        $scale = min(620 / $width, 230 / $height);
        $minX = min($xs); $maxY = max($ys);
        $project = static fn(array $p): string => round(20 + ($p[0] - $minX) * $cos * $scale, 2).','.round(20 + ($maxY - $p[1]) * $scale, 2);
        $points = implode(' ', array_map($project, $coords));
        $svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 660 270"><rect width="660" height="270" fill="#f2f5fa"/><polyline points="'.$points.'" fill="none" stroke="'.$e($route['color']).'" stroke-width="3"/>';
        foreach ($route['stops'] as $index => $stop) {
            [$cx, $cy] = explode(',', $project($stop['coordinates']));
            $svg .= '<circle cx="'.$cx.'" cy="'.$cy.'" r="4" fill="'.($stop['exchange'] ? '#f59e0b' : '#fff').'" stroke="#253858"/><text x="'.((float) $cx + 6).'" y="'.$cy.'" font-size="9">'.($index + 1).'</text>';
        }
        $svg .= '</svg>';
        $image = 'data:image/svg+xml;base64,'.base64_encode($svg);
        $html = '<!doctype html><html lang="'.$e($lang).'"><head><meta charset="utf-8"><title>'.$e($route['line'].' — '.$route['name']).'</title><style>'
            .'@page{margin:20mm}body{font:11px DejaVu Sans,sans-serif;color:#162840;line-height:1.5}h1{font-size:23px}h2{font-size:16px;margin-top:23px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px;border-bottom:1px solid #d7dfe8;vertical-align:top}thead{display:table-header-group}tr{page-break-inside:avoid}.meta,.muted{color:#56667c}.notes{white-space:pre-wrap}.trace{font-size:8px;overflow-wrap:anywhere}img{width:100%}</style></head><body>'
            .'<div class="meta">GTT TRAINER · '.$e($t[0]).'</div><h1>'.$e($route['line']).' · '.$e($route['name']).'</h1>'
            .'<p>'.$e($t[1]).' '.$e($route['revision']).' · '.$e($t[2]).': '.$e($route['status']).' · '.$e($t[9]).': '.$e($route['direction']).' · '.number_format($length / 1000, 2).' km</p>'
            .'<img alt="Fixed route geometry" src="'.$image.'"><h2>'.$e($t[5]).'</h2><p class="notes">'.$e($route['notes'] ?: $t[10]).'</p>'
            .'<h2>'.$e($t[4]).'</h2><table><thead><tr><th>#</th><th>m</th><th>'.$e($t[4]).'</th><th>'.$e($t[5]).'</th></tr></thead><tbody>';
        foreach ($route['instructions'] as $index => $instruction) {
            $visual='';
            foreach ($instruction['photos'] ?? [] as $photo) {
                if (isset($photos[$photo['id']])) $visual.='<div><img style="width:180px;max-height:140px" alt="'.$e($photo['caption'] ?: $instruction['text']).'" src="'.$photos[$photo['id']].'">';
                else $visual.='<div>';
                $visual.='<br>'.$e($photo['caption']).'<br>'.$e($photo['credit']).'</div>';
            }
            $html .= '<tr><td>'.($index + 1).'</td><td>'.round($instruction['offsetM']).'</td><td>'.$e($instruction['text']).$visual.'</td><td class="notes">'.$e($instruction['notes']).'</td></tr>';
        }
        $html .= '</tbody></table><h2>'.$e($t[3]).'</h2><table><thead><tr><th>#</th><th>m</th><th>'.$e($t[3]).'</th><th>'.$e($t[6]).' / '.$e($t[5]).'</th></tr></thead><tbody>';
        foreach ($route['stops'] as $index => $stop) $html .= '<tr><td>'.($index + 1).'</td><td>'.round($stop['offsetM']).'</td><td>'.$e($stop['code'].' '.$stop['name']).'</td><td class="notes">'.($stop['exchange'] ? $e($t[6].' · '.$stop['exchangeDirection']).'<br>' : '').$e($stop['notes']).'</td></tr>';
        $html .= '</tbody></table>';
        if (!empty($route['video'])) {
            $origin=rtrim(getenv('APP_ORIGIN') ?: '', '/');
            $html.='<h2>Video</h2><p>'.$e($route['video']['caption']).'<br>'.$e($route['video']['credit']).'<br><a href="'.$e($origin.'/api/v1/media/'.$route['video']['id']).'">'.$e($origin.'/api/v1/media/'.$route['video']['id']).'</a></p>';
        }
        $html .= '<h2>'.$e($t[7]).'</h2><p>'.$e($route['source']['name']).'<br>'.$e($route['source']['url']).'<br>'.$e($route['source']['license']).'<br>'.$e($route['source']['retrievedAt']).'</p>'
            .'<p class="muted">'.$e($t[11]).': '.gmdate('Y-m-d H:i').' UTC</p><p class="trace">'.$e($route['id'].' / '.$route['revisionId']).'</p></body></html>';
        return $html;
    }

    /**
     * Generate PDF bytes from trusted report HTML with remote resources disabled.
     */
    public static function pdf(string $html): string
    {
        $options = new \Dompdf\Options();
        $options->set('isRemoteEnabled', false);
        $options->set('isPhpEnabled', false);
        $options->set('isJavascriptEnabled', false);
        $options->set('defaultFont', 'DejaVu Sans');
        $options->setChroot(dirname(__DIR__).'/vendor/dompdf');
        $pdf = new \Dompdf\Dompdf($options);
        $pdf->loadHtml($html, 'UTF-8');
        $pdf->setPaper('A4');
        $pdf->render();
        return $pdf->output();
    }
}
