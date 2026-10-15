<?php
declare(strict_types=1);
use GttTrainer\Database;
function fixture(): array
{
    return [
        'line' => 'TEST-'.substr(Database::uuid(),0,8), 'name' => 'Synthetic route for tests only',
        'direction' => 'andata', 'kind' => 'service', 'color' => '#2463eb',
        'geometry' => ['type' => 'LineString', 'coordinates' => [[7.6,45.0],[7.61,45.0],[7.61,45.01]]],
        'stops' => [['id' => Database::uuid(), 'code' => 'TEST-'.Database::uuid(), 'name' => 'Shared test stop', 'coordinates' => [7.6,45.0], 'offsetM' => 0, 'exchange' => true, 'exchangeDirection' => 'andata', 'notes' => 'Change only outbound.']],
        'instructions' => [['offsetM'=>0,'text'=>'Start','notes'=>'','kind'=>'depart'],['offsetM'=>500,'text'=>'Continue','notes'=>'Landmark','kind'=>'straight']],
        'notes' => 'Test notes', 'source' => ['name'=>'Synthetic fixture, never a GTT route','url'=>'','license'=>'test only','retrievedAt'=>'2026-10-15'],
    ];
}
