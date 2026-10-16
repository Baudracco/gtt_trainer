<?php
use GttTrainer\{ErrorCatalog, ErrorLogger, FileLock};

check(count(ErrorCatalog::NUMBERS)===count(array_unique(ErrorCatalog::NUMBERS)), 'Numeric error identifiers are unique');
foreach (glob(dirname(__DIR__).'/src/*.php') as $path) {
    preg_match_all("/new ApiError\\([^,]+,\\s*'([^']+)'/",file_get_contents($path),$codes);
    foreach ($codes[1] as $code) if (!isset(ErrorCatalog::NUMBERS[$code])) throw new RuntimeException('Uncatalogued error: '.$code);
}
$diagnosticPath=tempnam(sys_get_temp_dir(),'gtt-errors-');$nativeLog=tempnam(sys_get_temp_dir(),'gtt-native-');
ini_set('error_log',$nativeLog);
check(FileLock::append($diagnosticPath,'ámbito de prueba'), 'Locked diagnostic append writes complete UTF-8 bytes');
check(file_get_contents($diagnosticPath)==="ámbito de prueba\n", 'Diagnostic byte count does not confuse characters with bytes');
$held=fopen($diagnosticPath,'ab');flock($held,LOCK_EX);
$started=hrtime(true);$available=FileLock::append($diagnosticPath,'must-time-out',25);$elapsed=(hrtime(true)-$started)/1e6;
check(!$available && $elapsed<500,'A contended file lock has a bounded timeout');
flock($held,LOCK_UN);fclose($held);
$result=ErrorLogger::record(new RuntimeException('PASSWORD=never-log-this'),'test-trace',null,$diagnosticPath);
$last=json_decode(trim(array_slice(file($diagnosticPath),-1)[0]),true);
check($result['file'] && $result['native'] && $last['number']===2099 && !str_contains(file_get_contents($diagnosticPath),'PASSWORD'), 'Sanitized redundant diagnostics omit raw exception messages and secrets');
$result=ErrorLogger::record(new RuntimeException('private'),'test-file-failure',null,$diagnosticPath.'/missing');
check(!$result['file'] && $result['native'],'An unavailable fallback file cannot suppress native diagnostics');
