<?php
declare(strict_types=1);
/** Build a dependency-free PHP API reference from native reflection and real DocBlocks. */
require dirname(__DIR__).'/server/vendor/autoload.php';

$root=dirname(__DIR__);
$out=$argv[1] ?? $root.'/docs/generated/php';
if (!is_dir($out) && !mkdir($out,0755,true) && !is_dir($out)) throw new RuntimeException('Cannot create reference output.');
$classes=[];$missing=[];
function cleanDoc(string|false $doc): string {
    if (!$doc) return '';
    $doc=preg_replace('~^/\*\*|\*/$~','',trim($doc));
    return trim(preg_replace('/^\s*\* ?/m','',$doc));
}
function typeName(?ReflectionType $type): string {return $type?(string)$type:'mixed';}
foreach (glob($root.'/server/src/*.php') as $path) {
    $class=new ReflectionClass('GttTrainer\\'.basename($path,'.php'));
    $description=cleanDoc($class->getDocComment());
    if ($description==='') $missing[]=$class->getName();
    $methods=[];
    foreach ($class->getMethods(ReflectionMethod::IS_PUBLIC) as $method) {
        if ($method->getDeclaringClass()->getName()!==$class->getName()) continue;
        $doc=cleanDoc($method->getDocComment());
        if ($doc==='') $missing[]=$class->getName().'::'.$method->getName();
        $params=[];
        foreach ($method->getParameters() as $param) {
            $text=typeName($param->getType()).' '.($param->isVariadic()?'...':'').($param->isPassedByReference()?'&':'').'$'.$param->getName();
            if ($param->isDefaultValueAvailable()) $text.=' = '.var_export($param->getDefaultValue(),true);
            $params[]=$text;
        }
        $signature=($method->isStatic()?'static ':'').$method->getName().'('.implode(', ',$params).'): '.typeName($method->getReturnType());
        $methods[]=['name'=>$method->getName(),'signature'=>$signature,'docblock'=>$doc,'line'=>$method->getStartLine()];
    }
    $classes[]=['name'=>$class->getShortName(),'namespace'=>$class->getNamespaceName(),'source'=>'server/src/'.basename($path),'docblock'=>$description,'methods'=>$methods];
}
if ($missing) {fwrite(STDERR,"Missing public DocBlocks:\n".implode("\n",$missing)."\n");exit(1);}
$markdown="# PHP API reference\n\nGenerated from native Reflection/getDocComment; do not edit generated files.\n\n";
$html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GTT Trainer · PHP reference</title><style>body{font:16px system-ui;max-width:1050px;margin:40px auto;padding:0 22px;color:#21344b}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f5fa;padding:15px;border-radius:8px}h2{margin-top:45px;border-bottom:1px solid #ccd7e7;padding-bottom:10px}a{color:#205ac8}code{font-size:.9em}</style><a href="../index.html">All references</a><h1>PHP API reference</h1><p>Generated from actual PHP DocBlocks and signatures; no services are instantiated.</p><nav>';
foreach ($classes as $class) $html.='<a href="#'.$class['name'].'">'.$class['name'].'</a> · ';
$html.='</nav>';
foreach ($classes as $class) {
    $markdown.='## '.$class['name']."\n\nSource: `".$class['source']."`\n\n".$class['docblock']."\n\n";
    $html.='<section id="'.$class['name'].'"><h2>'.$class['name'].'</h2><p><code>'.$class['source'].'</code></p><pre>'.htmlspecialchars($class['docblock']).'</pre>';
    foreach ($class['methods'] as $method) {
        $markdown.='### '.$class['name'].'::'.$method['name']."\n\n```php\n".$method['signature']."\n```\n\n".$method['docblock']."\n\n";
        $html.='<h3>'.htmlspecialchars($method['name']).'</h3><pre><code>'.htmlspecialchars($method['signature']).'</code></pre><pre>'.htmlspecialchars($method['docblock']).'</pre>';
    }
    $html.='</section>';
}
file_put_contents($out.'/reference.md',$markdown);
file_put_contents($out.'/index.html',$html);
file_put_contents($out.'/reference.json',json_encode($classes,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)."\n");
echo count($classes)." documented PHP classes; all declared public methods have DocBlocks.\n";
